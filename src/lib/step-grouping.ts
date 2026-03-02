import type { ProcessStep, ToolCall } from '@/types'
import { isThinkingStep, isToolCall, isContentBlock } from '@/types/process-step'

export interface ToolWithThinking {
  toolCall: ToolCall
  thinkingContent?: string
  trailingThinkingContent?: string
}

export type GroupedItem =
  | { kind: 'tool'; id: string; data: ToolWithThinking }
  | { kind: 'tool-group'; id: string; items: ToolWithThinking[] }
  | { kind: 'content'; id: string; content: string }
  | { kind: 'thinking'; id: string; content: string }

// Minimum total visible rows (thinking blocks + tool calls) to trigger grouping
const MIN_ROWS_TO_GROUP = 2

function countGroupRows(group: ToolWithThinking[]): number {
  return group.reduce(
    (total, item) =>
      total + 1 + (item.thinkingContent ? 1 : 0) + (item.trailingThinkingContent ? 1 : 0),
    0
  )
}

/**
 * Groups ordered process steps for compact display:
 * - Attaches thinking steps to the following tool call
 * - Absorbs trailing thinking (not followed by a tool call) into the preceding group
 * - Collapses sequences when total visible rows >= MIN_ROWS_TO_GROUP
 * - Passes through content blocks and truly standalone thinking
 */
export function groupOrderedSteps(orderedSteps: ProcessStep[]): GroupedItem[] {
  type IntermediateItem =
    | { kind: 'tool-item'; toolCall: ToolCall; thinkingContent?: string }
    | { kind: 'content'; id: string; content: string }
    | { kind: 'thinking'; id: string; content: string }

  const items: IntermediateItem[] = []
  let pendingThinking: { id: string; content: string } | null = null

  for (const step of orderedSteps) {
    if (isThinkingStep(step)) {
      if (pendingThinking) {
        pendingThinking.content += '\n\n' + step.content
      } else {
        pendingThinking = { id: step.id, content: step.content }
      }
    } else if (isToolCall(step)) {
      items.push({
        kind: 'tool-item',
        toolCall: step,
        thinkingContent: pendingThinking?.content,
      })
      pendingThinking = null
    } else if (isContentBlock(step)) {
      if (pendingThinking) {
        items.push({ kind: 'thinking', id: pendingThinking.id, content: pendingThinking.content })
        pendingThinking = null
      }
      items.push({ kind: 'content', id: step.id, content: step.content })
    }
  }

  if (pendingThinking) {
    items.push({ kind: 'thinking', id: pendingThinking.id, content: pendingThinking.content })
  }

  const result: GroupedItem[] = []
  let currentGroup: ToolWithThinking[] = []

  const flushGroup = () => {
    if (currentGroup.length === 0) return
    if (countGroupRows(currentGroup) >= MIN_ROWS_TO_GROUP) {
      result.push({
        kind: 'tool-group',
        id: `group-${currentGroup[0].toolCall.id}`,
        items: [...currentGroup],
      })
    } else {
      for (const item of currentGroup) {
        result.push({ kind: 'tool', id: item.toolCall.id, data: item })
      }
    }
    currentGroup = []
  }

  for (const item of items) {
    if (item.kind === 'tool-item') {
      const isCompleted = item.toolCall.status === 'success' || item.toolCall.status === 'error'
      if (isCompleted) {
        currentGroup.push({
          toolCall: item.toolCall,
          thinkingContent: item.thinkingContent,
        })
      } else {
        flushGroup()
        result.push({
          kind: 'tool',
          id: item.toolCall.id,
          data: { toolCall: item.toolCall, thinkingContent: item.thinkingContent },
        })
      }
    } else if (item.kind === 'thinking' && currentGroup.length > 0) {
      // Absorb trailing thinking into the last tool call (rendered after the tool call)
      const lastItem = currentGroup[currentGroup.length - 1]
      lastItem.trailingThinkingContent = lastItem.trailingThinkingContent
        ? lastItem.trailingThinkingContent + '\n\n' + item.content
        : item.content
    } else {
      flushGroup()
      result.push(item)
    }
  }
  flushGroup()

  return result
}
