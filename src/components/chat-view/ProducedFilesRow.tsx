import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FilePlus2, FilePen, Undo2 } from 'lucide-react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { type ProducedFile, fileLabel } from '@/lib/produced-files'
import { logger } from '@/lib/logger'

interface ProducedFilesRowProps {
  files: ProducedFile[]
  /** Conversation and the user message this turn answers (history key). */
  conversationId?: string
  turnId?: string
}

interface RestoreReport {
  restored: string[]
  removed: string[]
  failed: [string, string][]
}

const MAX_CHIPS = 8

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

/** Files this turn created or modified, as chips that reveal the file. */
export function ProducedFilesRow({ files, conversationId, turnId }: ProducedFilesRowProps) {
  const { t } = useTranslation('chat')
  const [canUndo, setCanUndo] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // Undo is offered while this device holds the turn's backups.
  useEffect(() => {
    if (!conversationId || !turnId || files.length === 0) return
    let cancelled = false
    invoke<unknown[]>('get_turn_file_history', { conversationId, userMessageId: turnId })
      .then((entries) => {
        if (!cancelled) setCanUndo(entries.length > 0)
      })
      .catch(() => {
        if (!cancelled) setCanUndo(false)
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, turnId, files.length])

  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(timer)
  }, [confirming])

  if (files.length === 0) return null

  const undo = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    try {
      const report = await invoke<RestoreReport>('restore_turn_files', {
        conversationId,
        userMessageId: turnId,
      })
      setCanUndo(false)
      const changed = report.restored.length + report.removed.length
      if (report.failed.length > 0) {
        toast.warning(t('producedFiles.undoPartial', { count: changed }), {
          description: report.failed.map(([path, reason]) => `${path}: ${reason}`).join('\n'),
        })
      } else {
        toast.success(t('producedFiles.undone', { count: changed }), {
          description: t('producedFiles.undoneHint'),
        })
      }
    } catch (error) {
      logger.error('Failed to restore files:', error)
      toast.error(t('producedFiles.undoFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const reveal = async (path: string) => {
    if (!isAbsolute(path)) {
      await navigator.clipboard.writeText(path)
      toast.info(t('producedFiles.pathCopied'))
      return
    }
    try {
      await revealItemInDir(path)
    } catch (error) {
      logger.error('Failed to reveal produced file:', error)
      toast.error(t('producedFiles.revealFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const shown = files.slice(0, MAX_CHIPS)
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2" data-testid="produced-files">
      {shown.map((file) => {
        const Icon = file.role === 'created' ? FilePlus2 : FilePen
        return (
          <button
            key={file.path}
            type="button"
            onClick={() => reveal(file.path)}
            title={`${t(`producedFiles.${file.role}`)}: ${file.path}`}
            className="inline-flex items-center gap-1 rounded-md border border-muted px-2 py-0.5 text-xs text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
          >
            <Icon className="size-3" />
            <span className="max-w-48 truncate">{fileLabel(file.path)}</span>
          </button>
        )
      })}
      {files.length > shown.length && (
        <span className="text-xs text-muted-foreground">
          {t('producedFiles.more', { count: files.length - shown.length })}
        </span>
      )}
      {canUndo && (
        <button
          type="button"
          onClick={undo}
          title={t('producedFiles.undoTitle')}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
            confirming
              ? 'border border-destructive text-destructive'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Undo2 className="size-3" />
          <span>{confirming ? t('producedFiles.undoConfirm') : t('producedFiles.undo')}</span>
        </button>
      )}
    </div>
  )
}
