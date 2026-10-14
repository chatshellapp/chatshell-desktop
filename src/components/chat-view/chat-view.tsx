import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { ChatInput } from '@/components/chat-input'
import { ScrollToBottomButton } from './scroll-to-bottom-button'
import { PendingMessageItem } from './PendingMessageItem'
import { MessageList } from './MessageList'
import { useSearchStore } from '@/stores/searchStore'
import { useMessageStore } from '@/stores/message'
import { useAttachmentBlobStore } from '@/stores/attachmentBlobStore'
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
    isLoading,
    hasOlderMessages,
    isLoadingOlder,
    isStreaming,
    isWaitingForAI,
    hasStreamingData,
    apiError,
    attachmentStatus,
    attachmentRefreshKey,
    urlStatuses,
    pendingMessages,
    handleClearApiError,
  } = useConversationState()

  const loadOlderMessages = useMessageStore((state) => state.loadOlderMessages)
  const ensureMessageLoaded = useMessageStore((state) => state.ensureMessageLoaded)

  // Upward paging: capture the scroll state before an older page prepends so
  // the layout effect below can restore the viewport position (R3.2).
  const anchorRef = useRef<{ scrollHeight: number; scrollTop: number; firstId: string } | null>(
    null
  )
  const handleNearTop = useCallback(() => {
    if (!conversationId) return
    const cs = useMessageStore.getState().conversationStates[conversationId]
    if (!cs?.hasOlderMessages || cs.isLoadingOlder) return
    const container = messagesContainerRef.current
    if (container) {
      anchorRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
        firstId: cs.messages[0]?.id ?? '',
      }
    }
    void loadOlderMessages(conversationId).then((loaded) => {
      if (!loaded) anchorRef.current = null
    })
  }, [conversationId, loadOlderMessages])

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
    conversationId,
    onNearTop: handleNearTop,
  })

  // Restore the scroll position after an older page prepended: the content
  // grew upward by exactly the height delta, so shift scrollTop by it. Only
  // applies when the first message actually changed (a plain append at the
  // tail must not shift the viewport).
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const container = messagesContainerRef.current
    anchorRef.current = null
    if (!container) return
    if (messages[0]?.id === anchor.firstId) return
    const delta = container.scrollHeight - anchor.scrollHeight
    if (delta > 0) container.scrollTop = anchor.scrollTop + delta
  }, [messages, messagesContainerRef])

  const { rootRef, inputAreaRef, inputAreaHeight, manualInputHeight, handleDragStart } =
    useInputResize()

  const messageResources = useMessageResources({
    messages,
    attachmentStatus,
    attachmentRefreshKey,
  })

  // Fetch-on-open (plan §5): materialize attachment bytes referenced by this
  // conversation (newest-first, budgeted) so previews resolve locally. A
  // pass that MATERIALIZED bytes also repaired the referencing rows'
  // storage_path (iOS-authored rows carry absolute sandbox paths) — re-resolve
  // message resources so already-rendered tiles drop the stale foreign paths
  // (real-device 2026-08-28: the synced image stayed broken until reload).
  const fetchBlobs = useAttachmentBlobStore((s) => s.fetchForConversation)
  const incrementAttachmentRefreshKey = useMessageStore(
    (state) => state.incrementAttachmentRefreshKey
  )
  useEffect(() => {
    if (!conversationId) return
    void fetchBlobs(conversationId).then((materialized) => {
      if (materialized) incrementAttachmentRefreshKey(conversationId)
    })
  }, [conversationId, fetchBlobs, incrementAttachmentRefreshKey])

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

  const handleExportStreamingConversation = useCallback(() => {
    void handleExportConversation(null)
  }, [handleExportConversation])

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
  const showStreamingMessage = isWaitingForAI || (isStreaming && hasStreamingData)

  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_type === 'user') return messages[i]
    }
    return null
  }, [messages])

  // In-conversation search jump. The target may be older than the loaded
  // window: page older messages in until it is present, then scroll to it.
  // revealAll forces the progressively mounted window to mount in one commit
  // — the target row may sit outside the mounted tail slice.
  const targetMessageId = useSearchStore((s) => s.targetMessageId)
  const [revealAll, setRevealAll] = useState(false)
  useEffect(() => {
    setRevealAll(false)
  }, [conversationId])
  useEffect(() => {
    if (!targetMessageId || !conversationId) return
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        setRevealAll(true)
        if (!document.getElementById(`message-${targetMessageId}`)) {
          await ensureMessageLoaded(conversationId, targetMessageId)
        }
        if (cancelled) return
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
      })()
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [targetMessageId, conversationId, ensureMessageLoaded])

  return (
    <div ref={rootRef} className="flex flex-col flex-1 overflow-hidden">
      {/* Messages Area */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4"
        onScroll={handleScroll}
      >
        {messages.length === 0 && !isStreaming && !isWaitingForAI ? (
          // Distinguish "fetching the window" from "genuinely empty": without
          // the isLoading branch the empty state flashes for the duration of
          // every conversation switch.
          isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p className="text-sm animate-pulse">{t('loadingMessages')}</p>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>{t('noMessagesStart')}</p>
            </div>
          )
        ) : (
          <MessageList
            conversationId={conversationId ?? ''}
            messages={messages}
            lastUserMessage={lastUserMessage}
            showStreamingMessage={showStreamingMessage}
            messageResources={messageResources}
            urlStatuses={urlStatuses}
            apiError={apiError}
            isLoadingOlder={isLoadingOlder || (hasOlderMessages && messages.length === 0)}
            revealAll={revealAll}
            messagesContentRef={messagesContentRef}
            messagesEndRef={messagesEndRef}
            getDisplayInfo={getDisplayInfo}
            getMessageDisplayInfo={getMessageDisplayInfo}
            onClearApiError={handleClearApiError}
            onCopy={handleCopy}
            onRevert={handleRevert}
            onFork={handleFork}
            onExportAll={handleExportAll}
            onExportConversation={handleExportConversation}
            onExportStreamingConversation={handleExportStreamingConversation}
            onExportMessage={handleExportMessage}
          />
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
