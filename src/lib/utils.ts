import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parse thinking content from streaming/complete LLM responses.
 * Supports <think>, <thinking>, and <reasoning> tags.
 * Returns both the cleaned content and any extracted thinking content.
 */
export interface ParsedThinkingContent {
  content: string
  thinkingContent: string | null
  /** True if we're currently inside an unclosed thinking tag (streaming) */
  isThinkingInProgress: boolean
}

export function parseThinkingContent(text: string): ParsedThinkingContent {
  const thinkingParts: string[] = []
  let cleanedContent = text
  let isThinkingInProgress = false

  // Patterns for complete tags (case insensitive)
  const patterns = [
    /<think>([\s\S]*?)<\/think>/gi,
    /<thinking>([\s\S]*?)<\/thinking>/gi,
    /<reasoning>([\s\S]*?)<\/reasoning>/gi,
  ]

  // Extract complete thinking blocks
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      thinkingParts.push(match[1].trim())
    }
    cleanedContent = cleanedContent.replace(pattern, '')
  }

  // Check for unclosed tags (streaming in progress)
  const unclosedPatterns = [
    { open: /<think>/i, close: /<\/think>/i, tag: 'think' },
    { open: /<thinking>/i, close: /<\/thinking>/i, tag: 'thinking' },
    { open: /<reasoning>/i, close: /<\/reasoning>/i, tag: 'reasoning' },
  ]

  for (const { open, close, tag } of unclosedPatterns) {
    const openMatch = cleanedContent.match(open)
    if (openMatch && !close.test(cleanedContent.slice(openMatch.index))) {
      // We have an unclosed tag - extract the partial content
      isThinkingInProgress = true
      const startIdx = openMatch.index! + openMatch[0].length
      const partialThinking = cleanedContent.slice(startIdx).trim()
      if (partialThinking) {
        thinkingParts.push(partialThinking)
      }
      // Remove the unclosed tag from content
      cleanedContent = cleanedContent.slice(0, openMatch.index)
    }
  }

  cleanedContent = cleanedContent.trim()

  return {
    content: cleanedContent,
    thinkingContent: thinkingParts.length > 0 ? thinkingParts.join('\n\n') : null,
    isThinkingInProgress,
  }
}

export function formatConversationTimestamp(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} min ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`

  return date.toLocaleDateString()
}
