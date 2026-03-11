import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { ChatInput } from '@/components/chat-input'
import { ApiErrorPreview } from './api-error-preview'
import { ScrollToBottomButton } from './scroll-to-bottom-button'
import { MessageItem } from './MessageItem'
import { StreamingMessage } from './StreamingMessage'
import { PendingMessageItem } from './PendingMessageItem'
import { useSearchStore } from '@/stores/searchStore'
import { useMessageStore } from '@/stores/message'
import {
  useScrollBehavior,
  useInputResize,
  useMessageResources,
  useDisplayInfo,
  useConversationState,
  useMessageHandlers,
} from './hooks'

export function ChatView() {
  const { t } = useTranslation('chat')

  // Get conversation state from stores
  const {
    conversationId,
    selectedModel,
    selectedAssistant,
    messages,
    isStreaming,
    streamingContent,
    streamingReasoningContent,
    isReasoningActive,
    isWaitingForAI,
    apiError,
    attachmentStatus,
    attachmentRefreshKey,
    urlStatuses,
    pendingSearchDecisions,
    streamingToolCalls,
    streamingImages,
    pendingMessages,
    handleClearApiError,
  } = useConversationState()

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
    streamingReasoningContent,
    isStreaming,
    isWaitingForAI,
    isReasoningActive,
    pendingSearchDecisionsCount: Object.keys(pendingSearchDecisions).length,
    attachmentRefreshKey,
    conversationId,
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

  const {
    handleCopy,
    handleRevert,
    handleFork,
    handleExportAll,
    handleExportConversation,
    handleExportMessage,
    handleScrollToBottom,
  } = useMessageHandlers({
    messagesEndRef,
    messagesContentRef,
    setIsAtBottom,
  })

  const removePendingMessage = useMessageStore((state) => state.removePendingMessage)
  const handleRemovePending = useCallback(
    (index: number) => {
      if (conversationId) {
        removePendingMessage(conversationId, index)
      }
    },
    [conversationId, removePendingMessage]
  )

  // Show streaming message while actively streaming, waiting for AI,
  // or when there's frozen partial content from a stopped generation.
  const hasStreamingToolCalls = Object.keys(streamingToolCalls).length > 0
  const hasStreamingImages = streamingImages.length > 0
  const hasStreamingData =
    !!streamingContent || !!streamingReasoningContent || hasStreamingToolCalls || hasStreamingImages
  const showStreamingMessage = isWaitingForAI || (isStreaming && hasStreamingData)

  const targetMessageId = useSearchStore((s) => s.targetMessageId)
  useEffect(() => {
    if (!targetMessageId) return
    const timer = setTimeout(() => {
      const el = document.getElementById(`message-${targetMessageId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('search-highlight')
        setTimeout(() => {
          el.classList.remove('search-highlight')
          useSearchStore.getState().clearTarget()
        }, 2500)
      } else {
        useSearchStore.getState().clearTarget()
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [targetMessageId])

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
            <p>{t('noMessagesStart')}</p>
          </div>
        ) : (
          <div ref={messagesContentRef} className="max-w-4xl mx-auto py-4">
            {messages.map((message, index) => (
              <MessageItem
                key={message.id}
                message={message}
                messages={messages}
                index={index}
                messageResources={messageResources}
                urlStatuses={urlStatuses}
                getMessageDisplayInfo={getMessageDisplayInfo}
                onCopy={handleCopy}
                onRevert={handleRevert}
                onFork={handleFork}
                onExportAll={handleExportAll}
                onExportConversation={handleExportConversation}
                onExportMessage={handleExportMessage}
              />
            ))}
            {showStreamingMessage && (
              <StreamingMessage
                messages={messages}
                messageResources={messageResources}
                urlStatuses={urlStatuses}
                pendingSearchDecisions={pendingSearchDecisions}
                streamingToolCalls={streamingToolCalls}
                streamingImages={streamingImages}
                isWaitingForAI={isWaitingForAI}
                isStreaming={isStreaming}
                streamingContent={streamingContent}
                streamingReasoningContent={streamingReasoningContent}
                isReasoningActive={isReasoningActive}
                getDisplayInfo={getDisplayInfo}
                onCopy={handleCopy}
                onExportAll={handleExportAll}
                onExportConversation={handleExportConversation}
                onExportMessage={() => {}}
              />
            )}
            {/* API Error display */}
            {apiError && (
              <div className="py-2">
                <ApiErrorPreview error={apiError} onDismiss={handleClearApiError} />
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

      {/* Pending messages (outside scroll area to avoid jitter during streaming) */}
      {pendingMessages.length > 0 && (
        <div className="shrink-0 bg-background/80 backdrop-blur-sm overflow-y-auto max-h-40">
          <div className="max-w-4xl mx-auto py-1">
            <div className="flex justify-end items-center gap-1.5 px-4 pt-1 pb-0.5 text-xs text-muted-foreground/60">
              <Clock className="size-3" />
              <span>{t('queuedCount', { count: pendingMessages.length })}</span>
              <div className="w-6 shrink-0" />
            </div>
            {pendingMessages.map((pm, idx) => (
              <PendingMessageItem
                key={`pending-${idx}`}
                content={pm.content}
                onRemove={() => handleRemovePending(idx)}
              />
            ))}
          </div>
        </div>
      )}

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
          title={t('dragToResize')}
        >
          <div className="w-12 h-1 bg-muted-foreground/20 rounded-full backdrop-blur-sm group-hover:bg-muted-foreground/40 transition-colors" />
        </div>

        <div className="p-4 flex flex-col h-full overflow-y-auto">
          <ChatInput />
        </div>
      </div>
    </div>
  )
}
