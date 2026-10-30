import type { ProcessStep, ToolCall } from '@/types'
import { isThinkingStep, isToolCall, isContentBlock } from '@/types/process-step'

export interface ToolWithThinking {
  toolCall: ToolCall
  thinkingContent?: string
}

export type GroupedItem =
  | { kind: 'tool'; id: string; data: ToolWithThinking }
  | { kind: 'content'; id: string; content: string }
  | { kind: 'thinking'; id: string; content: string }

/**
 * Groups ordered process steps for display:
 * - Merges consecutive thinking steps into one block
 * - Attaches a thinking block to the tool call that follows it
 * - Passes through content blocks and thinking not followed by a tool call
 *
 * Collapsing is the run fold's job (see RunFold); tool calls are not grouped.
 */
export function groupOrderedSteps(orderedSteps: ProcessStep[]): GroupedItem[] {
  const items: GroupedItem[] = []
  let pendingThinking: { id: string; content: string } | null = null

  const flushThinking = () => {
    if (!pendingThinking) return
    items.push({ kind: 'thinking', id: pendingThinking.id, content: pendingThinking.content })
    pendingThinking = null
  }

  for (const step of orderedSteps) {
    if (isThinkingStep(step)) {
      if (pendingThinking) {
        pendingThinking.content += '\n\n' + step.content
      } else {
        pendingThinking = { id: step.id, content: step.content }
      }
    } else if (isToolCall(step)) {
      items.push({
        kind: 'tool',
        id: step.id,
        data: { toolCall: step, thinkingContent: pendingThinking?.content },
      })
      pendingThinking = null
    } else if (isContentBlock(step)) {
      flushThinking()
      items.push({ kind: 'content', id: step.id, content: step.content })
    }
  }
  flushThinking()

  return items
}

/**
 * Splits a run into the fold (process) and what follows it (final answer).
 * The fold holds everything up to the last tool call plus thinking right
 * after it; the text from the first content block after the last tool call
 * on is the answer and stays outside. Without tool calls there is no fold.
 */
export function splitRunItems(items: GroupedItem[]): {
  fold: GroupedItem[]
  after: GroupedItem[]
} {
  let lastTool = -1
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === 'tool') {
      lastTool = i
      break
    }
  }
  if (lastTool < 0) return { fold: [], after: items }
  const tail = items.slice(lastTool + 1)
  const firstContent = tail.findIndex((item) => item.kind === 'content')
  if (firstContent < 0) return { fold: items, after: [] }
  return {
    fold: items.slice(0, lastTool + 1 + firstContent),
    after: tail.slice(firstContent),
  }
}

/** Fold header counts: steps are tool calls and thinking blocks; text
 * between tool calls is not a step. */
export function countRunSteps(items: GroupedItem[]): { steps: number; failedTools: number } {
  let steps = 0
  let failedTools = 0
  for (const item of items) {
    if (item.kind === 'tool') {
      steps += item.data.thinkingContent ? 2 : 1
      if (item.data.toolCall.status === 'error') failedTools += 1
    } else if (item.kind === 'thinking') {
      steps += 1
    }
  }
  return { steps, failedTools }
}
