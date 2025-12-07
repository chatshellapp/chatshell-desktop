import { useEffect } from 'react'
import { ChatInput } from '@/components/chat-input'
import { ChatMessage } from '@/components/chat-message'
import {
  AttachmentPreview,
  ThinkingPreview,
  type ImageAttachmentData,
} from '@/components/attachment-preview'
import { useConversationStore } from '@/stores/conversationStore'
import { useMessageStore } from '@/stores/messageStore'
import { useChatEvents } from '@/hooks/useChatEvents'
import { parseThinkingContent } from '@/lib/utils'
import type { ContextEnrichment, ProcessStep } from '@/types'

import { ApiErrorPreview } from './api-error-preview'
import { ScrollToBottomButton } from './scroll-to-bottom-button'
import { CHAT_CONFIG, formatTimestamp } from './utils'
import {
  useScrollBehavior,
  useInputResize,
  useMessageResources,
  useDisplayInfo,
} from './hooks'

export function ChatView() {
  const currentConversation = useConversationStore((state) => state.currentConversation)
  const selectedModel = useConversationStore((state) => state.selectedModel)
  const selectedAssistant = useConversationStore((state) => state.selectedAssistant)

  // Get conversation-specific state
  const conversationState = useMessageStore((state) =>
    currentConversation ? state.getConversationState(currentConversation.id) : null
  )

  const loadMessages = useMessageStore((state) => state.loadMessages)
  const clearApiError = useMessageStore((state) => state.clearApiError)

  // Extract values from conversation state with defaults
  const messages = conversationState?.messages || []
  const isStreaming = conversationState?.isStreaming || false
  const streamingContent = conversationState?.streamingContent || ''
  // Streaming reasoning content from API (GPT-5, Gemini with thinking)
  const streamingReasoningContent = conversationState?.streamingReasoningContent || ''
  // Whether reasoning has actually started (received first reasoning chunk)
  const isReasoningActive = conversationState?.isReasoningActive || false
  const attachmentStatus = conversationState?.attachmentStatus || 'idle'
  const attachmentRefreshKey = conversationState?.attachmentRefreshKey || 0
  const isWaitingForAI = conversationState?.isWaitingForAI || false
  const urlStatuses = conversationState?.urlStatuses || {}
  const pendingSearchDecisions = conversationState?.pendingSearchDecisions || {}
  const apiError = conversationState?.apiError || null

  // Custom hooks
  const {
    messagesEndRef,
    messagesContainerRef,
    messagesContentRef,
    isAtBottom,
    setIsAtBottom,
    buttonLeft,
    handleScroll,
  } = useScrollBehavior({
    messagesLength: messages.length,
    streamingContent,
    isStreaming,
    isWaitingForAI,
    conversationId: currentConversation?.id || null,
  })

  const { rootRef, inputAreaRef, inputAreaHeight, manualInputHeight, handleDragStart } =
    useInputResize()

  const messageResources = useMessageResources({
    messages,
    attachmentStatus,
    attachmentRefreshKey,
  })

  const { getDisplayInfo, getMessageDisplayInfo } = useDisplayInfo({
    selectedModel,
    selectedAssistant,
  })

  // Set up event listeners for chat streaming and scraping
  useChatEvents(currentConversation?.id || null)

  // Load messages when conversation changes
  useEffect(() => {
    if (currentConversation) {
      loadMessages(currentConversation.id)
    }
  }, [currentConversation, loadMessages])

  // Handler functions (placeholders for future implementation)
  const handleCopy = () => {
    console.log('Message copied')
  }

  const handleResend = () => {
    console.log('Resend message')
  }

  const handleTranslate = () => {
    console.log('Translate message')
  }

  const handleExportAll = () => {
    console.log('Export all messages')
  }

  const handleExportConversation = () => {
    console.log('Export current conversation')
  }

  const handleExportMessage = () => {
    console.log('Export current message')
  }

  const handleScrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setIsAtBottom(true)
  }

  return (
    <div ref={rootRef} className="flex flex-col flex-1 overflow-hidden">
      {/* Messages Area */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4"
        onScroll={handleScroll}
      >
        {messages.length === 0 && !isStreaming && !isWaitingForAI ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>No messages yet. Start a conversation!</p>
          </div>
        ) : (
          <div ref={messagesContentRef} className="max-w-4xl mx-auto py-4">
            {messages.map((message, index) => {
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
                    userMessageAlign={CHAT_CONFIG.userMessageAlign}
                    userMessageShowBackground={CHAT_CONFIG.userMessageShowBackground}
                    headerContent={headerContent}
                    onCopy={handleCopy}
                    onResend={handleResend}
                    onTranslate={handleTranslate}
                    onExportAll={handleExportAll}
                    onExportConversation={handleExportConversation}
                    onExportMessage={handleExportMessage}
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
            })}
            {(isWaitingForAI ||
              (isStreaming &&
                (streamingContent || streamingReasoningContent) &&
                !isWaitingForAI)) &&
              (() => {
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
                    onCopy={handleCopy}
                    onResend={handleResend}
                    onTranslate={handleTranslate}
                    onExportAll={handleExportAll}
                    onExportConversation={handleExportConversation}
                    onExportMessage={handleExportMessage}
                  />
                )
              })()}
            {/* API Error display */}
            {apiError && (
              <div className="py-2">
                <ApiErrorPreview
                  error={apiError}
                  onDismiss={() => {
                    if (currentConversation) {
                      clearApiError(currentConversation.id)
                    }
                  }}
                />
              </div>
            )}
            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      <ScrollToBottomButton
        isVisible={!isAtBottom}
        inputAreaHeight={inputAreaHeight}
        buttonLeft={buttonLeft}
        onScrollToBottom={handleScrollToBottom}
      />

      {/* Input Area */}
      <div
        ref={inputAreaRef}
        className="shrink-0 bg-background border-t relative flex flex-col"
        style={manualInputHeight ? { height: manualInputHeight } : undefined}
      >
        {/* Drag Handle */}
        <div
          className="absolute top-0 left-0 right-0 h-3 -mt-1.5 cursor-ns-resize z-50 flex items-center justify-center hover:bg-accent/10 transition-colors group"
          onMouseDown={handleDragStart}
          title="Drag to resize"
        >
          <div className="w-12 h-1 bg-muted-foreground/20 rounded-full backdrop-blur-sm group-hover:bg-muted-foreground/40 transition-colors" />
        </div>

        <div className="p-4 flex justify-center h-full overflow-y-auto">
          <ChatInput />
        </div>
      </div>
    </div>
  )
}

