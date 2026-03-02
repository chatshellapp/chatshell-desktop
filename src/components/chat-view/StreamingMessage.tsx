import { ChatMessage } from '@/components/chat-message'
import { AttachmentPreview, ThinkingPreview } from '@/components/attachment-preview'
import {
  ToolCallPreview,
  type StreamingToolCall,
} from '@/components/attachment-preview/tool-call-preview'
import { MarkdownContent } from '@/components/markdown-content'
import { parseThinkingContent } from '@/lib/utils'
import type { Message, UrlStatus } from '@/types'
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
  onResend: () => void
  onTranslate: () => void
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
  onResend,
  onTranslate,
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
  const isThinkingInProgress = streamingReasoningContent
    ? isStreaming // If we have API reasoning, it's in progress while streaming
    : parsedStreaming.isThinkingInProgress

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

  if (
    hasAssistantResources ||
    hasPendingDecision ||
    hasStreamingThinking ||
    showThinkingPlaceholder ||
    hasStreamingToolCalls
  ) {
    // If we have interleaved content, render it properly ordered
    if (hasInterleavedContent) {
      streamingHeaderContent = (
        <div className="space-y-2 mb-2">
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
          {/* Interleaved tool calls with reasoning and content between them */}
          {sortedToolCalls.map((toolCall, index) => {
            // Calculate API reasoning segment (from reasoning_content field)
            let reasoningSegment = ''
            if (index === 0) {
              reasoningSegment = toolCall.reasoningBefore || ''
            } else {
              const prevToolCall = sortedToolCalls[index - 1]
              const prevReasoningLength = prevToolCall.reasoningBefore?.length || 0
              const currentReasoningLength = toolCall.reasoningBefore?.length || 0
              if (currentReasoningLength > prevReasoningLength) {
                reasoningSegment = (toolCall.reasoningBefore || '').slice(prevReasoningLength)
              }
            }

            // Calculate content segment and extract XML thinking from <think> tags
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

            return (
              <div key={toolCall.id} className="space-y-2">
                {/* API reasoning before this tool call */}
                {reasoningSegment && reasoningSegment.trim() && searchDecisionResolved && (
                  <ThinkingPreview content={reasoningSegment} isStreaming={false} />
                )}
                {/* XML <think> tag thinking from content before this tool call */}
                {xmlThinkingSegment && xmlThinkingSegment.trim() && searchDecisionResolved && (
                  <ThinkingPreview content={xmlThinkingSegment} isStreaming={false} />
                )}
                {/* Content before this tool call */}
                {contentSegment && contentSegment.trim() && (
                  <div className="text-base text-foreground prose prose-sm dark:prose-invert max-w-none">
                    <MarkdownContent content={contentSegment} />
                  </div>
                )}
                {/* The tool call itself */}
                <ToolCallPreview
                  streamingToolCall={toolCall}
                  isStreaming={toolCall.status === 'running' || toolCall.status === 'pending'}
                />
              </div>
            )
          })}
          {/* Show remaining reasoning/thinking after last tool call */}
          {(() => {
            const lastToolCall = sortedToolCalls[sortedToolCalls.length - 1]
            const elements: React.ReactNode[] = []

            // Remaining API reasoning
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

            // Remaining XML thinking from content after last tool call
            const lastContentLength = lastToolCall?.contentBefore?.length || 0
            if (streamingContent.length > lastContentLength) {
              const rawSegment = streamingContent.slice(lastContentLength)
              const parsed = parseThinkingContent(rawSegment)
              if (parsed.thinkingContent && parsed.thinkingContent.trim() && searchDecisionResolved) {
                elements.push(
                  <ThinkingPreview
                    key="remaining-xml-thinking"
                    content={parsed.thinkingContent}
                    isStreaming={parsed.isThinkingInProgress}
                  />
                )
              }
            }

            return elements.length > 0 ? <>{elements}</> : null
          })()}
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
              isStreaming={toolCall.status === 'running' || toolCall.status === 'pending'}
            />
          ))}
        </div>
      )
    }
  }

  // Calculate the content to display after all tool calls
  // This is the content that came after the last tool call
  let finalContent = parsedStreaming.content
  if (hasInterleavedContent && sortedToolCalls.length > 0) {
    const lastToolCall = sortedToolCalls[sortedToolCalls.length - 1]
    const lastContentLength = lastToolCall.contentBefore?.length || 0
    const totalContentLength = streamingContent.length
    if (totalContentLength > lastContentLength) {
      const rawSegment = streamingContent.slice(lastContentLength)
      const parsed = parseThinkingContent(rawSegment)
      finalContent = parsed.content
    } else {
      finalContent = ''
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
      headerContent={streamingHeaderContent}
      onCopy={onCopy}
      onResend={onResend}
      onTranslate={onTranslate}
      onExportAll={onExportAll}
      onExportConversation={onExportConversation}
      onExportMessage={onExportMessage}
    />
  )
}
