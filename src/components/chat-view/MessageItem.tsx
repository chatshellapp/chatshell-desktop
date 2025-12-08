import { ChatMessage } from '@/components/chat-message'
import {
  AttachmentPreview,
  ThinkingPreview,
  type ImageAttachmentData,
} from '@/components/attachment-preview'
import type { Message, ContextEnrichment, ProcessStep, UrlStatus } from '@/types'
import { CHAT_CONFIG, formatTimestamp } from './utils'
import type { DisplayInfo } from './hooks'

interface MessageResources {
  attachments: any[]
  contexts: ContextEnrichment[]
  steps: ProcessStep[]
}

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
    ? resources.contexts.filter(
        (c) => c.type === 'fetch_result' && (c as any).source_type !== 'search'
      )
    : []

  // Check if this message has a search result (URLs will be shown inside it)
  const hasSearchResult = resources.contexts.some((c) => c.type === 'search_result')
  const messageUrlStatuses = hasSearchResult ? undefined : urlStatuses[message.id]
  const urls = messageUrlStatuses ? Object.keys(messageUrlStatuses) : []

  const hasUserAttachments =
    isUserMessage &&
    (userAttachments.length > 0 || userFetchResults.length > 0 || urls.length > 0)

  // For assistant messages in history, get context and steps from previous user message
  let contextsToShow: ContextEnrichment[] = []
  let stepsToShow: ProcessStep[] = []
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
      stepsToShow = prevResources.steps.filter((s) => s.type === 'search_decision')
    }
  }

  // Get thinking steps from the assistant message itself
  const thinkingSteps = resources.steps.filter((s) => s.type === 'thinking')
  const hasThinkingContent = isAssistantMessage && thinkingSteps.length > 0
  const hasAssistantResources = contextsToShow.length > 0 || stepsToShow.length > 0

  // Build headerContent for assistant messages (steps, contexts, thinking shown between header and content)
  const headerContent =
    isAssistantMessage && (hasAssistantResources || hasThinkingContent) ? (
      <div className="space-y-1.5 mb-2">
        {/* Search decisions first */}
        {stepsToShow.map((step) => (
          <AttachmentPreview key={(step as any).id} step={step} />
        ))}
        {/* Then search results */}
        {contextsToShow.map((context) => (
          <AttachmentPreview
            key={(context as any).id}
            context={context}
            urlStatuses={
              context.type === 'search_result' && prevUserMessageId
                ? urlStatuses[prevUserMessageId]
                : undefined
            }
            messageId={prevUserMessageId ?? undefined}
          />
        ))}
        {/* Finally thinking content */}
        {thinkingSteps.map((step) => (
          <ThinkingPreview key={(step as any).id} content={(step as any).content} />
        ))}
      </div>
    ) : undefined

  return (
    <div key={message.id}>
      <ChatMessage
        role={role}
        content={message.content}
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
        headerContent={headerContent}
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
                (a) => a.type === 'file' && (a as any).mime_type?.startsWith('image/')
              )
              const allImages: ImageAttachmentData[] = imageAttachments.map((a) => ({
                id: (a as any).id,
                fileName: (a as any).file_name,
                storagePath: (a as any).storage_path,
              }))

              return userAttachments.map((attachment) => {
                // Check if this is an image to determine index
                const isImage =
                  attachment.type === 'file' &&
                  (attachment as any).mime_type?.startsWith('image/')
                const imageIndex = isImage
                  ? imageAttachments.findIndex(
                      (img) => (img as any).id === (attachment as any).id
                    )
                  : undefined

                return (
                  <AttachmentPreview
                    key={(attachment as any).id}
                    userAttachment={attachment}
                    allImages={isImage ? allImages : undefined}
                    currentImageIndex={imageIndex}
                  />
                )
              })
            })()}
            {/* User-provided fetch results (webpage attachments) */}
            {userFetchResults.map((context) => (
              <AttachmentPreview key={(context as any).id} context={context} />
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

