import { ChatMessage } from '@/components/chat-message'
import { AttachmentPreview, ThinkingPreview } from '@/components/attachment-preview'
import { parseThinkingContent } from '@/lib/utils'
import type { Message, ContextEnrichment, ProcessStep, UrlStatus } from '@/types'
import { CHAT_CONFIG } from './utils'
import type { DisplayInfo } from './hooks'

interface MessageResources {
  attachments: any[]
  contexts: ContextEnrichment[]
  steps: ProcessStep[]
}

interface StreamingMessageProps {
  messages: Message[]
  messageResources: Record<string, MessageResources>
  urlStatuses: Record<string, Record<string, UrlStatus>>
  pendingSearchDecisions: Record<string, boolean>
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
  const combinedThinkingContent =
    streamingReasoningContent || parsedStreaming.thinkingContent
  const isThinkingInProgress = streamingReasoningContent
    ? isStreaming // If we have API reasoning, it's in progress while streaming
    : parsedStreaming.isThinkingInProgress

  // Get the last user message to show its resources
  const lastUserMessage = messages
    .filter((m) => m.sender_type === 'user')
    .slice(-1)[0]

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
  const searchResultContexts = lastUserResources.contexts.filter(
    (c) => c.type === 'search_result'
  )
  // Get search decisions from steps
  const searchDecisionSteps = lastUserResources.steps.filter(
    (s) => s.type === 'search_decision'
  )

  const hasPendingDecision = lastUserMessage
    ? pendingSearchDecisions[lastUserMessage.id]
    : false
  const hasAssistantResources =
    searchResultContexts.length > 0 || searchDecisionSteps.length > 0
  const hasStreamingThinking = combinedThinkingContent !== null

  // Show thinking when reasoning has actually started (received first reasoning chunk)
  // This provides visual feedback that reasoning models (GPT-5, o1, etc.) are actively thinking
  // Note: We only show thinking when:
  // 1. isReasoningActive is true (not during the initial waiting phase)
  // 2. Search decision process is resolved - either:
  //    - No pending decision was started, OR
  //    - The search decision step has been loaded
  // This ensures the "Deciding if web search is needed..." / "No search needed" UI
  // appears BEFORE the thinking placeholder
  const searchDecisionResolved =
    !hasPendingDecision || searchDecisionSteps.length > 0
  const showThinkingPlaceholder = isReasoningActive && searchDecisionResolved

  if (
    hasAssistantResources ||
    hasPendingDecision ||
    hasStreamingThinking ||
    showThinkingPlaceholder
  ) {
    streamingHeaderContent = (
      <div className="space-y-1.5 mb-2">
        {/* Show pending search decision preview */}
        {hasPendingDecision && searchDecisionSteps.length === 0 && (
          <AttachmentPreview pendingSearchDecision={true} />
        )}
        {/* Show search decisions */}
        {searchDecisionSteps.map((step) => (
          <AttachmentPreview key={(step as any).id} step={step} />
        ))}
        {/* Show search results (fetch results from search are shown inside) */}
        {searchResultContexts.map((context) => (
          <AttachmentPreview
            key={(context as any).id}
            context={context}
            urlStatuses={
              lastUserMessage ? urlStatuses[lastUserMessage.id] : undefined
            }
            messageId={lastUserMessage?.id}
          />
        ))}
        {/* Show thinking placeholder while waiting, or actual content when available */}
        {/* Only show when search decision is resolved */}
        {searchDecisionResolved &&
          (showThinkingPlaceholder || combinedThinkingContent) && (
            <ThinkingPreview
              content={combinedThinkingContent || ''}
              isStreaming={showThinkingPlaceholder || isThinkingInProgress}
            />
          )}
      </div>
    )
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
      content={showContent ? parsedStreaming.content : ''}
      timestamp="Now"
      displayName={info.displayName}
      senderType={info.senderType}
      modelLogo={info.modelLogo}
      assistantLogo={info.assistantLogo}
      avatarBg={info.avatarBg}
      avatarText={info.avatarText}
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

