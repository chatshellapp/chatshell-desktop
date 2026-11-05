import { useTranslation } from 'react-i18next'
import { FilePlus2, FilePen } from 'lucide-react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
import { type ProducedFile, fileLabel } from '@/lib/produced-files'
import { logger } from '@/lib/logger'

interface ProducedFilesRowProps {
  files: ProducedFile[]
}

const MAX_CHIPS = 8

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

/** Files this turn created or modified, as chips that reveal the file. */
export function ProducedFilesRow({ files }: ProducedFilesRowProps) {
  const { t } = useTranslation('chat')
  if (files.length === 0) return null

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
    </div>
  )
}
