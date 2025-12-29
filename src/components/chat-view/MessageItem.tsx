import { ChatMessage } from '@/components/chat-message'
import {
  AttachmentPreview,
  ThinkingPreview,
  type ImageAttachmentData,
} from '@/components/attachment-preview'
import { MarkdownContent } from '@/components/markdown-content'
import type { Message, ContextEnrichment, ProcessStep, UrlStatus } from '@/types'
import { isContentBlock, isThinkingStep, isToolCall, getDisplayOrder } from '@/types/process-step'
import type { MessageResources } from '@/types/message-resources'
import { CHAT_CONFIG, formatTimestamp } from './utils'
import type { DisplayInfo } from './hooks'

interface MessageItemProps {
  message: Message
  messages: Message[]
  index: number
  messageResources: Record<string, MessageResources>
  urlStatuses: Record<string, Record<string, UrlStatus>>
  getMessageDisplayInfo: (message: Message) => DisplayInfo
  onCopy: () => void
  onResend: () => void
  onTranslate: () => void
  onExportAll: () => void
  onExportConversation: () => void
  onExportMessage: () => void
}

export function MessageItem({
  message,
  messages,
  index,
  messageResources,
  urlStatuses,
  getMessageDisplayInfo,
  onCopy,
  onResend,
  onTranslate,
  onExportAll,
  onExportConversation,
  onExportMessage,
}: MessageItemProps) {
  const info = getMessageDisplayInfo(message)
  // Map sender_type to ChatMessage role: "user" stays "user", both "model" and "assistant" become "assistant"
  const role = message.sender_type === 'user' ? 'user' : 'assistant'
  const isUserMessage = message.sender_type === 'user'
  const isAssistantMessage = !isUserMessage

  // Get resources for this message
  const resources = messageResources[message.id] || {
    attachments: [],
    contexts: [],
    steps: [],
  }

  // User attachments (files, user links) - shown right-aligned after user message
  const userAttachments = resources.attachments

  // Get fetch results for user message - only user-initiated ones (not from search)
  // Search-initiated fetch results should be shown inside SearchResultPreview
  const userFetchResults = isUserMessage
    ? resources.contexts.filter((c) => c.type === 'fetch_result' && c.source_type !== 'search')
    : []

  // Check if this message has a search result (URLs will be shown inside it)
  const hasSearchResult = resources.contexts.some((c) => c.type === 'search_result')
  const messageUrlStatuses = hasSearchResult ? undefined : urlStatuses[message.id]
  const urls = messageUrlStatuses ? Object.keys(messageUrlStatuses) : []

  const hasUserAttachments =
    isUserMessage && (userAttachments.length > 0 || userFetchResults.length > 0 || urls.length > 0)

  // For assistant messages in history, get context and steps from previous user message
  let contextsToShow: ContextEnrichment[] = []
  let searchDecisionSteps: ProcessStep[] = []
  let prevUserMessageId: string | null = null
  if (isAssistantMessage && index > 0) {
    const prevMessage = messages[index - 1]
    if (prevMessage.sender_type === 'user') {
      prevUserMessageId = prevMessage.id
      const prevResources = messageResources[prevMessage.id] || {
        attachments: [],
        contexts: [],
        steps: [],
      }
      // Only show search_result - fetch_results from search are shown inside SearchResultPreview
      contextsToShow = prevResources.contexts.filter((c) => c.type === 'search_result')
      // Show search decisions from previous user message
      searchDecisionSteps = prevResources.steps.filter((s) => s.type === 'search_decision')
    }
  }

  // Check if we have content blocks for interleaved display
  const contentBlocks = resources.steps.filter(isContentBlock)
  const hasContentBlocks = contentBlocks.length > 0

  // Get steps that should be displayed in order (thinking, tool calls, content blocks)
  const orderedSteps = resources.steps
    .filter((s) => isThinkingStep(s) || isToolCall(s) || isContentBlock(s))
    .sort((a, b) => getDisplayOrder(a) - getDisplayOrder(b))

  // Check if we have any interleaved content (tool calls with content blocks)
  const hasInterleavedContent = hasContentBlocks && orderedSteps.length > 1

  // For non-interleaved display, use the old approach
  const thinkingSteps = resources.steps.filter(isThinkingStep)
  const toolCallSteps = resources.steps.filter(isToolCall)
  const hasThinkingContent = isAssistantMessage && thinkingSteps.length > 0
  const hasToolCalls = isAssistantMessage && toolCallSteps.length > 0
  const hasAssistantResources =
    contextsToShow.length > 0 || searchDecisionSteps.length > 0 || hasToolCalls

  // Build interleaved content for assistant messages
  // This shows steps and content blocks in the correct order based on display_order
  const interleavedContent =
    isAssistantMessage && hasInterleavedContent ? (
      <div className="space-y-2">
        {/* Search decisions first (from previous user message) */}
        {searchDecisionSteps.map((step) => (
          <AttachmentPreview key={step.id} step={step} />
        ))}
        {/* Search results (from previous user message) */}
        {contextsToShow.map((context) => (
          <AttachmentPreview
            key={context.id}
            context={context}
            urlStatuses={
              context.type === 'search_result' && prevUserMessageId
                ? urlStatuses[prevUserMessageId]
                : undefined
            }
            messageId={prevUserMessageId ?? undefined}
          />
        ))}
        {/* Interleaved steps and content blocks in display_order */}
        {orderedSteps.map((step) => {
          if (isThinkingStep(step)) {
            return <ThinkingPreview key={step.id} content={step.content} />
          }
          if (isToolCall(step)) {
            return <AttachmentPreview key={step.id} step={step} />
          }
          if (isContentBlock(step)) {
            return (
              <div
                key={step.id}
                className="text-base text-foreground prose prose-sm dark:prose-invert max-w-none"
              >
                <MarkdownContent content={step.content} />
              </div>
            )
          }
          return null
        })}
      </div>
    ) : null

  // Build headerContent for non-interleaved assistant messages
  // (steps, contexts, thinking shown between header and content)
  const headerContent =
    isAssistantMessage && !hasInterleavedContent && (hasAssistantResources || hasThinkingContent) ? (
      <div className="space-y-1.5 mb-2">
        {/* Search decisions first */}
        {searchDecisionSteps.map((step) => (
          <AttachmentPreview key={step.id} step={step} />
        ))}
        {/* Then search results */}
        {contextsToShow.map((context) => (
          <AttachmentPreview
            key={context.id}
            context={context}
            urlStatuses={
              context.type === 'search_result' && prevUserMessageId
                ? urlStatuses[prevUserMessageId]
                : undefined
            }
            messageId={prevUserMessageId ?? undefined}
          />
        ))}
        {/* Thinking content */}
        {thinkingSteps.map((step) => (
          <ThinkingPreview key={step.id} content={step.content} />
        ))}
        {/* Tool calls (MCP) - shown below thinking */}
        {toolCallSteps.map((step) => (
          <AttachmentPreview key={step.id} step={step} />
        ))}
      </div>
    ) : undefined

  return (
    <div key={message.id}>
      <ChatMessage
        role={role}
        // When we have interleaved content, don't show message.content separately
        // as it's already included in the content blocks
        content={hasInterleavedContent ? '' : message.content}
        timestamp={formatTimestamp(message.created_at)}
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
        headerContent={hasInterleavedContent ? interleavedContent : headerContent}
        onCopy={onCopy}
        onResend={onResend}
        onTranslate={onTranslate}
        onExportAll={onExportAll}
        onExportConversation={onExportConversation}
        onExportMessage={onExportMessage}
      />

      {/* User attachments - rendered right-aligned after user message */}
      {hasUserAttachments && (
        <div className="flex justify-end px-4 my-1">
          <div className="max-w-[80%] space-y-1.5">
            {(() => {
              // Collect all image attachments for lightbox navigation
              const imageAttachments = userAttachments.filter(
                (a) => a.type === 'file' && a.mime_type?.startsWith('image/')
              )
              const allImages: ImageAttachmentData[] = imageAttachments.map((a) => ({
                id: a.id,
                fileName: a.file_name,
                storagePath: a.storage_path,
              }))

              return userAttachments.map((attachment) => {
                // Check if this is an image to determine index
                const isImage =
                  attachment.type === 'file' && attachment.mime_type?.startsWith('image/')
                const imageIndex = isImage
                  ? imageAttachments.findIndex((img) => img.id === attachment.id)
                  : undefined

                return (
                  <AttachmentPreview
                    key={attachment.id}
                    userAttachment={attachment}
                    allImages={isImage ? allImages : undefined}
                    currentImageIndex={imageIndex}
                  />
                )
              })
            })()}
            {/* User-provided fetch results (webpage attachments) */}
            {userFetchResults.map((context) => (
              <AttachmentPreview key={context.id} context={context} />
            ))}
            {/* Standalone processing URLs (no search result) */}
            {urls.map((url) => (
              <AttachmentPreview key={url} processingUrl={url} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
