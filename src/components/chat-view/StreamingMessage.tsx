import { ChatMessage } from '@/components/chat-message'
import { AttachmentPreview, ThinkingPreview } from '@/components/attachment-preview'
import {
  ToolCallPreview,
  type StreamingToolCall,
} from '@/components/attachment-preview/tool-call-preview'
import { CollapsedToolGroup } from '@/components/attachment-preview/collapsed-tool-group'
import { MarkdownContent } from '@/components/markdown-content'
import { parseThinkingContent } from '@/lib/utils'
import type { ToolWithThinking } from '@/lib/step-grouping'
import type { Message, ToolCall, UrlStatus } from '@/types'
import type { MessageResources } from '@/types/message-resources'
import { CHAT_CONFIG } from './utils'
import type { DisplayInfo } from './hooks'

interface StreamingMessageProps {
  messages: Message[]
  messageResources: Record<string, MessageResources>
  urlStatuses: Record<string, Record<string, UrlStatus>>
  pendingSearchDecisions: Record<string, boolean>
  streamingToolCalls: Record<string, StreamingToolCall>
  isWaitingForAI: boolean
  isStreaming: boolean
  streamingContent: string
  streamingReasoningContent: string
  isReasoningActive: boolean
  getDisplayInfo: () => DisplayInfo
  onCopy: () => void
  onExportAll: () => void
  onExportConversation: () => void
  onExportMessage: () => void
}

export function StreamingMessage({
  messages,
  messageResources,
  urlStatuses,
  pendingSearchDecisions,
  streamingToolCalls,
  isWaitingForAI,
  isStreaming,
  streamingContent,
  streamingReasoningContent,
  isReasoningActive,
  getDisplayInfo,
  onCopy,
  onExportAll,
  onExportConversation,
  onExportMessage,
}: StreamingMessageProps) {
  const info = getDisplayInfo()

  // Parse thinking content from streaming output (XML tags like <think>)
  const parsedStreaming = isWaitingForAI
    ? { content: '', thinkingContent: null, isThinkingInProgress: false }
    : parseThinkingContent(streamingContent)

  // Combine API-provided reasoning (GPT-5, Gemini) with XML-parsed thinking
  // API reasoning takes precedence as it's the native format for reasoning models
  const combinedThinkingContent = streamingReasoningContent || parsedStreaming.thinkingContent
  const isThinkingInProgress =
    isStreaming &&
    (streamingReasoningContent ? true : parsedStreaming.isThinkingInProgress)

  // Get the last user message to show its resources
  const lastUserMessage = messages.filter((m) => m.sender_type === 'user').slice(-1)[0]

  // Build headerContent with contexts, steps, and thinking preview
  let streamingHeaderContent: React.ReactNode = undefined
  const lastUserResources = lastUserMessage
    ? messageResources[lastUserMessage.id] || {
        attachments: [],
        contexts: [],
        steps: [],
      }
    : { attachments: [], contexts: [], steps: [] }

  // Only get search results - fetch results from search are shown inside SearchResultPreview
  const searchResultContexts = lastUserResources.contexts.filter((c) => c.type === 'search_result')
  // Get search decisions from steps
  const searchDecisionSteps = lastUserResources.steps.filter((s) => s.type === 'search_decision')

  const hasPendingDecision = lastUserMessage ? pendingSearchDecisions[lastUserMessage.id] : false
  const hasAssistantResources = searchResultContexts.length > 0 || searchDecisionSteps.length > 0
  const hasStreamingThinking = combinedThinkingContent !== null
  const hasStreamingToolCalls = Object.keys(streamingToolCalls).length > 0

  // Show thinking when reasoning has actually started (received first reasoning chunk)
  // This provides visual feedback that reasoning models (GPT-5, o1, etc.) are actively thinking
  // Note: We only show thinking when:
  // 1. isReasoningActive is true (not during the initial waiting phase)
  // 2. Search decision process is resolved - either:
  //    - No pending decision was started, OR
  //    - The search decision step has been loaded
  // This ensures the "Deciding if web search is needed..." / "No search needed" UI
  // appears BEFORE the thinking placeholder
  const searchDecisionResolved = !hasPendingDecision || searchDecisionSteps.length > 0
  const showThinkingPlaceholder = isReasoningActive && searchDecisionResolved

  // Sort tool calls by order for proper display
  const sortedToolCalls = Object.values(streamingToolCalls).sort((a, b) => a.order - b.order)

  // Check if we have interleaved content (tool calls with content or reasoning before them)
  const hasInterleavedContent =
    hasStreamingToolCalls &&
    sortedToolCalls.some(
      (tc) =>
        (tc.contentBefore && tc.contentBefore.length > 0) ||
        (tc.reasoningBefore && tc.reasoningBefore.length > 0)
    )

  // Calculate the content to display after all tool calls
  let finalContent = parsedStreaming.content
  if (hasInterleavedContent && sortedToolCalls.length > 0) {
    const lastToolCall = sortedToolCalls[sortedToolCalls.length - 1]
    const lastContentLength = lastToolCall.contentBefore?.length || 0
    if (streamingContent.length > lastContentLength) {
      const rawSegment = streamingContent.slice(lastContentLength)
      const parsed = parseThinkingContent(rawSegment)
      finalContent = parsed.content
    } else {
      finalContent = ''
    }
  }

  // Collapse completed tool calls once the model starts outputting final content
  const allToolCallsCompleted =
    sortedToolCalls.length > 0 &&
    sortedToolCalls.every((tc) => tc.status === 'success' || tc.status === 'error')
  const shouldCollapseTools = allToolCallsCompleted && finalContent.trim().length > 0

  if (
    hasAssistantResources ||
    hasPendingDecision ||
    hasStreamingThinking ||
    showThinkingPlaceholder ||
    hasStreamingToolCalls
  ) {
    if (hasInterleavedContent) {
      // Smart per-segment grouping: collapse completed tool calls before content boundaries
      const elements: React.ReactNode[] = []
      let pendingCompleted: { tc: StreamingToolCall; thinkingContent?: string }[] = []

      const toCollapsedItems = (
        pending: { tc: StreamingToolCall; thinkingContent?: string }[]
      ): ToolWithThinking[] =>
        pending.map((item) => ({
          toolCall: {
            id: item.tc.id,
            tool_name: item.tc.tool_name,
            tool_input: item.tc.tool_input,
            tool_output: item.tc.tool_output,
            status: item.tc.status,
            error: item.tc.error,
            display_order: item.tc.order,
            created_at: '',
          } as ToolCall,
          thinkingContent: item.thinkingContent,
        }))

      const flushAsCollapsed = () => {
        if (pendingCompleted.length === 0) return
        const rowCount = pendingCompleted.reduce(
          (total, item) => total + 1 + (item.thinkingContent ? 1 : 0),
          0
        )
        if (rowCount >= 2) {
          const items = toCollapsedItems(pendingCompleted)
          elements.push(<CollapsedToolGroup key={`group-${items[0].toolCall.id}`} items={items} />)
          pendingCompleted = []
        } else {
          flushAsIndividual()
        }
      }

      const flushAsIndividual = () => {
        for (const item of pendingCompleted) {
          elements.push(
            <div key={item.tc.id} className="space-y-2">
              {item.thinkingContent && item.thinkingContent.trim() && searchDecisionResolved && (
                <ThinkingPreview content={item.thinkingContent} isStreaming={false} />
              )}
              <ToolCallPreview streamingToolCall={item.tc} isStreaming={false} />
            </div>
          )
        }
        pendingCompleted = []
      }

      for (let index = 0; index < sortedToolCalls.length; index++) {
        const toolCall = sortedToolCalls[index]

        // Calculate API reasoning segment
        let reasoningSegment = ''
        if (index === 0) {
          reasoningSegment = toolCall.reasoningBefore || ''
        } else {
          const prevReasoningLength = sortedToolCalls[index - 1].reasoningBefore?.length || 0
          if ((toolCall.reasoningBefore?.length || 0) > prevReasoningLength) {
            reasoningSegment = (toolCall.reasoningBefore || '').slice(prevReasoningLength)
          }
        }

        // Calculate content segment and extract XML thinking
        let contentSegment = ''
        let xmlThinkingSegment: string | null = null
        const prevContentLength =
          index === 0 ? 0 : sortedToolCalls[index - 1].contentBefore?.length || 0
        const currentContentLength = toolCall.contentBefore?.length || 0
        if (currentContentLength > prevContentLength) {
          const rawSegment = (toolCall.contentBefore || '').slice(prevContentLength)
          const parsed = parseThinkingContent(rawSegment)
          contentSegment = parsed.content
          xmlThinkingSegment = parsed.thinkingContent
        }

        // Combine thinking sources for this tool call
        const thinkingParts = [reasoningSegment, xmlThinkingSegment].filter(
          (p): p is string => !!p && p.trim().length > 0
        )
        const thinkingContent = thinkingParts.length > 0 ? thinkingParts.join('\n\n') : undefined

        const isCompleted = toolCall.status === 'success' || toolCall.status === 'error'

        // Content boundary: collapse preceding completed tool calls
        if (contentSegment.trim()) {
          flushAsCollapsed()
          elements.push(
            <div
              key={`content-${index}`}
              className="text-base text-foreground prose prose-sm dark:prose-invert max-w-none"
            >
              <MarkdownContent content={contentSegment} />
            </div>
          )
        }

        if (isCompleted) {
          pendingCompleted.push({ tc: toolCall, thinkingContent })
        } else {
          flushAsIndividual()
          elements.push(
            <div key={toolCall.id} className="space-y-2">
              {thinkingContent && thinkingContent.trim() && searchDecisionResolved && (
                <ThinkingPreview content={thinkingContent} isStreaming={false} />
              )}
              <ToolCallPreview
                streamingToolCall={toolCall}
                isStreaming={
                  isStreaming && (toolCall.status === 'running' || toolCall.status === 'pending')
                }
              />
            </div>
          )
        }
      }

      // Flush remaining: collapse if final content follows, otherwise show individually
      if (pendingCompleted.length > 0) {
        if (finalContent.trim()) {
          flushAsCollapsed()
        } else {
          flushAsIndividual()
        }
      }

      // Remaining reasoning/thinking after last tool call
      {
        const lastToolCall = sortedToolCalls[sortedToolCalls.length - 1]

        const lastReasoningLength = lastToolCall?.reasoningBefore?.length || 0
        if (streamingReasoningContent.length > lastReasoningLength) {
          const remainingReasoning = streamingReasoningContent.slice(lastReasoningLength)
          if (remainingReasoning.trim() && searchDecisionResolved) {
            elements.push(
              <ThinkingPreview
                key="remaining-api-reasoning"
                content={remainingReasoning}
                isStreaming={isThinkingInProgress}
              />
            )
          }
        }

        const lastContentLength = lastToolCall?.contentBefore?.length || 0
        if (streamingContent.length > lastContentLength) {
          const rawSegment = streamingContent.slice(lastContentLength)
          const parsed = parseThinkingContent(rawSegment)
          if (parsed.thinkingContent?.trim() && searchDecisionResolved) {
            elements.push(
              <ThinkingPreview
                key="remaining-xml-thinking"
                content={parsed.thinkingContent}
                isStreaming={parsed.isThinkingInProgress}
              />
            )
          }
        }
      }

      streamingHeaderContent = (
        <div className="space-y-2 mb-2">
          {hasPendingDecision && searchDecisionSteps.length === 0 && (
            <AttachmentPreview pendingSearchDecision={true} />
          )}
          {searchDecisionSteps.map((step) => (
            <AttachmentPreview key={step.id} step={step} />
          ))}
          {searchResultContexts.map((context) => (
            <AttachmentPreview
              key={context.id}
              context={context}
              urlStatuses={lastUserMessage ? urlStatuses[lastUserMessage.id] : undefined}
              messageId={lastUserMessage?.id}
            />
          ))}
          {elements}
        </div>
      )
    } else if (shouldCollapseTools) {
      const collapsedItems: ToolWithThinking[] = sortedToolCalls.map((tc, index) => ({
        toolCall: {
          id: tc.id,
          tool_name: tc.tool_name,
          tool_input: tc.tool_input,
          tool_output: tc.tool_output,
          status: tc.status,
          error: tc.error,
          display_order: tc.order,
          created_at: '',
        } as ToolCall,
        thinkingContent: index === 0 ? (combinedThinkingContent ?? undefined) : undefined,
      }))

      streamingHeaderContent = (
        <div className="space-y-1.5 mb-2">
          {hasPendingDecision && searchDecisionSteps.length === 0 && (
            <AttachmentPreview pendingSearchDecision={true} />
          )}
          {searchDecisionSteps.map((step) => (
            <AttachmentPreview key={step.id} step={step} />
          ))}
          {searchResultContexts.map((context) => (
            <AttachmentPreview
              key={context.id}
              context={context}
              urlStatuses={lastUserMessage ? urlStatuses[lastUserMessage.id] : undefined}
              messageId={lastUserMessage?.id}
            />
          ))}
          <CollapsedToolGroup items={collapsedItems} />
        </div>
      )
    } else {
      // Non-interleaved display (original behavior)
      streamingHeaderContent = (
        <div className="space-y-1.5 mb-2">
          {/* Show pending search decision preview */}
          {hasPendingDecision && searchDecisionSteps.length === 0 && (
            <AttachmentPreview pendingSearchDecision={true} />
          )}
          {/* Show search decisions */}
          {searchDecisionSteps.map((step) => (
            <AttachmentPreview key={step.id} step={step} />
          ))}
          {/* Show search results (fetch results from search are shown inside) */}
          {searchResultContexts.map((context) => (
            <AttachmentPreview
              key={context.id}
              context={context}
              urlStatuses={lastUserMessage ? urlStatuses[lastUserMessage.id] : undefined}
              messageId={lastUserMessage?.id}
            />
          ))}
          {/* Show thinking placeholder while waiting, or actual content when available */}
          {/* Only show when search decision is resolved */}
          {searchDecisionResolved && (showThinkingPlaceholder || combinedThinkingContent) && (
            <ThinkingPreview
              content={combinedThinkingContent || ''}
              isStreaming={showThinkingPlaceholder || isThinkingInProgress}
            />
          )}
          {/* Show streaming tool calls (MCP) - below thinking, ordered */}
          {sortedToolCalls.map((toolCall) => (
            <ToolCallPreview
              key={toolCall.id}
              streamingToolCall={toolCall}
              isStreaming={
                isStreaming && (toolCall.status === 'running' || toolCall.status === 'pending')
              }
            />
          ))}
        </div>
      )
    }
  }

  // Only show content when:
  // 1. Not waiting for AI, AND
  // 2. Search decision is resolved (no pending decision, or decision step exists)
  // This ensures the "No search needed" UI appears BEFORE the response content
  const showContent = !isWaitingForAI && searchDecisionResolved

  return (
    <ChatMessage
      key={isWaitingForAI ? 'waiting' : 'streaming'}
      role="assistant"
      content={showContent ? finalContent : ''}
      timestamp="Now"
      displayName={info.displayName}
      senderType={info.senderType}
      modelLogo={info.modelLogo}
      assistantLogo={info.assistantLogo}
      avatarBg={info.avatarBg}
      avatarText={info.avatarText}
      assistantName={info.assistantName}
      assistantRole={info.assistantRole}
      assistantDescription={info.assistantDescription}
      assistantModelName={info.assistantModelName}
      assistantModelId={info.assistantModelId}
      userMessageAlign={CHAT_CONFIG.userMessageAlign}
      userMessageShowBackground={CHAT_CONFIG.userMessageShowBackground}
      isLoading={isWaitingForAI || !searchDecisionResolved}
      isStreaming={isStreaming}
      headerContent={streamingHeaderContent}
      onCopy={onCopy}
      onExportAll={onExportAll}
      onExportConversation={onExportConversation}
      onExportMessage={onExportMessage}
    />
  )
}
