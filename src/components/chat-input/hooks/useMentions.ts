import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { type Attachment, getFileType } from '../types'
import {
  isRejected,
  readDocumentFromPath,
  readImageFromPath,
  reportRejected,
} from '../attachment-ingest'
import { activeMention, applyMention, rankMentionCandidates } from '@/lib/mention'
import { logger } from '@/lib/logger'

export interface MentionState {
  query: string
  matches: string[]
  selected: number
  loading: boolean
  /** No working directory: nothing to mention. */
  noWorkingDirectory: boolean
}

interface UseMentionsOptions {
  input: string
  setInput: React.Dispatch<React.SetStateAction<string>>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  workingDirectory: string | null | undefined
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
  visionDisabled: boolean
}

function joinPath(root: string, relative: string): string {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${relative}`
}

/**
 * `@` in the composer: pick a file from the conversation's working
 * directory. The path is inserted into the text and the file is attached,
 * so it reaches the model through the normal attachment projection.
 */
export function useMentions({
  input,
  setInput,
  textareaRef,
  workingDirectory,
  setAttachments,
  visionDisabled,
}: UseMentionsOptions) {
  const { t } = useTranslation('messages')
  const [caret, setCaret] = useState<number | null>(null)
  const [selected, setSelected] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [candidates, setCandidates] = useState<string[] | null>(null)
  const loadedRoot = useRef<string | null>(null)

  const mention = caret === null ? null : activeMention(input, caret)
  const open = mention !== null && dismissedAt !== mention.start

  // Load the working directory's files once per root while a mention is open.
  useEffect(() => {
    if (!open || !workingDirectory || loadedRoot.current === workingDirectory) return
    loadedRoot.current = workingDirectory
    setCandidates(null)
    invoke<string[]>('list_mention_candidates', { root: workingDirectory })
      .then(setCandidates)
      .catch((error) => {
        logger.error('[mentions] Failed to list working directory:', error)
        setCandidates([])
      })
  }, [open, workingDirectory])

  const query = mention?.query ?? ''
  const matches = useMemo(
    () => (open && candidates ? rankMentionCandidates(candidates, query, 50) : []),
    [open, candidates, query]
  )

  const state: MentionState | null = open
    ? {
        query,
        matches,
        selected: Math.min(selected, Math.max(matches.length - 1, 0)),
        loading: !!workingDirectory && candidates === null,
        noWorkingDirectory: !workingDirectory,
      }
    : null

  /** Track the caret (call from onChange/onSelect/onKeyUp/onClick). */
  const syncCaret = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    setCaret(textarea.selectionStart === textarea.selectionEnd ? textarea.selectionStart : null)
    setSelected(0)
  }, [textareaRef])

  const close = useCallback(() => {
    if (mention) setDismissedAt(mention.start)
  }, [mention])

  const attach = useCallback(
    async (relative: string) => {
      if (!workingDirectory) return
      const kind = getFileType(relative)
      if (kind === 'unsupported' || (kind === 'image' && visionDisabled)) return
      const absolute = joinPath(workingDirectory, relative)
      try {
        const result =
          kind === 'image'
            ? await readImageFromPath(absolute, relative)
            : await readDocumentFromPath(t, absolute, relative)
        if (isRejected(result)) {
          reportRejected(t, [result])
          return
        }
        const named = { ...result, name: relative }
        setAttachments((prev) => (prev.some((a) => a.name === relative) ? prev : [...prev, named]))
      } catch (error) {
        logger.error(`[mentions] Failed to attach ${absolute}`, error)
        toast.error(t('failedToReadFile', { file: relative }), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [workingDirectory, visionDisabled, setAttachments, t]
  )

  const pick = useCallback(
    (relative: string) => {
      if (!mention) return
      const next = applyMention(input, mention, relative)
      setInput(next.text)
      setCaret(next.caret)
      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(next.caret, next.caret)
      })
      void attach(relative)
    },
    [mention, input, setInput, textareaRef, attach]
  )

  /** Handle navigation keys while the picker is open; true when consumed. */
  const handleMentionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!state || e.nativeEvent.isComposing) return false
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return true
      }
      if (state.matches.length === 0) return false
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setSelected((state.selected + step + state.matches.length) % state.matches.length)
        return true
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        pick(state.matches[state.selected])
        return true
      }
      return false
    },
    [state, close, pick]
  )

  return {
    mentionState: state,
    syncCaret,
    handleMentionKeyDown,
    pickMention: pick,
    closeMention: close,
  }
}
