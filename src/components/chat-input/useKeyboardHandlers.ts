import React, { useEffect, useRef } from 'react'

interface UseKeyboardHandlersOptions {
  input: string
  setInput: React.Dispatch<React.SetStateAction<string>>
  onSubmit: () => void
  /** Global sent-prompt history, newest first */
  inputHistory: string[]
}

export function useKeyboardHandlers({
  input,
  setInput,
  onSubmit,
  inputHistory,
}: UseKeyboardHandlersOptions) {
  // Index into inputHistory while browsing; null when composing normally
  const historyIndexRef = useRef<number | null>(null)

  // Any edit that diverges from the recalled entry exits history browsing.
  // Also handles a shrinking history (cap eviction) via undefined compare.
  useEffect(() => {
    const index = historyIndexRef.current
    if (index !== null && input !== inputHistory[index]) {
      historyIndexRef.current = null
    }
  }, [input, inputHistory])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition keys have keyCode 229
    // This is the most reliable way to detect IME input
    if (e.nativeEvent.keyCode === 229 || e.nativeEvent.isComposing) {
      return // Let IME handle the input
    }

    const noModifiers = !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey

    // ArrowUp: recall previously sent messages (terminal-style history).
    // Only enters browsing from an empty input so multiline cursor movement
    // keeps working; while browsing, Up/Down keep navigating.
    if (e.key === 'ArrowUp' && noModifiers) {
      const index = historyIndexRef.current
      if ((input === '' || index !== null) && inputHistory.length > 0) {
        const next = index === null ? 0 : Math.min(index + 1, inputHistory.length - 1)
        if (next !== index) {
          e.preventDefault()
          historyIndexRef.current = next
          setInput(inputHistory[next])
          // Move cursor to the end after the value swap
          const textarea = e.currentTarget
          const end = inputHistory[next].length
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = end
          }, 0)
        }
      }
      return
    }

    // ArrowDown: move toward newer history; past the newest entry restores
    // the (empty) draft and exits browsing
    if (e.key === 'ArrowDown' && noModifiers) {
      const index = historyIndexRef.current
      if (index !== null) {
        e.preventDefault()
        if (index > 0) {
          historyIndexRef.current = index - 1
          setInput(inputHistory[index - 1])
          const textarea = e.currentTarget
          const end = inputHistory[index - 1].length
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = end
          }, 0)
        } else {
          historyIndexRef.current = null
          setInput('')
        }
      }
      return
    }

    // Command+Enter or Ctrl+Enter: insert new line manually
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      const textarea = e.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = input.substring(0, start) + '\n' + input.substring(end)
      setInput(newValue)

      // Set cursor position after the inserted newline
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1
      }, 0)
      return
    }

    // Enter without modifiers: send message
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return { handleKeyDown }
}
