import React from 'react'

interface UseKeyboardHandlersOptions {
  input: string
  setInput: React.Dispatch<React.SetStateAction<string>>
  onSubmit: () => void
}

export function useKeyboardHandlers({ input, setInput, onSubmit }: UseKeyboardHandlersOptions) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition keys have keyCode 229
    // This is the most reliable way to detect IME input
    if (e.nativeEvent.keyCode === 229 || e.nativeEvent.isComposing) {
      return // Let IME handle the input
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

