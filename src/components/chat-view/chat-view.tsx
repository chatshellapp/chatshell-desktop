import { ChatInput } from '@/components/chat-input'
import { ApiErrorPreview } from './api-error-preview'
import { ScrollToBottomButton } from './scroll-to-bottom-button'
import { MessageItem } from './MessageItem'
import { StreamingMessage } from './StreamingMessage'
import {
  useScrollBehavior,
  useInputResize,
  useMessageResources,
  useDisplayInfo,
  useConversationState,
  useMessageHandlers,
} from './hooks'

export function ChatView() {
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
    handleResend,
    handleTranslate,
    handleExportAll,
    handleExportConversation,
    handleExportMessage,
    handleScrollToBottom,
  } = useMessageHandlers({
    messagesEndRef,
    setIsAtBottom,
  })

  // Check if streaming message should be shown
  const showStreamingMessage =
    isWaitingForAI ||
    (isStreaming && (streamingContent || streamingReasoningContent) && !isWaitingForAI)

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
                onResend={handleResend}
                onTranslate={handleTranslate}
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
                isWaitingForAI={isWaitingForAI}
                isStreaming={isStreaming}
                streamingContent={streamingContent}
                streamingReasoningContent={streamingReasoningContent}
                isReasoningActive={isReasoningActive}
                getDisplayInfo={getDisplayInfo}
                onCopy={handleCopy}
                onResend={handleResend}
                onTranslate={handleTranslate}
                onExportAll={handleExportAll}
                onExportConversation={handleExportConversation}
                onExportMessage={handleExportMessage}
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
