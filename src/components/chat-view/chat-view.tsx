import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { ChatInput } from '@/components/chat-input'
import { ScrollToBottomButton } from './scroll-to-bottom-button'
import { PendingMessageItem } from './PendingMessageItem'
import { MessageList } from './MessageList'
import { PermissionApprovalDialog } from './PermissionApprovalDialog'
import { useSearchStore } from '@/stores/searchStore'
import { useMessageStore } from '@/stores/message'
import { useAttachmentBlobStore } from '@/stores/attachmentBlobStore'
import { requestTranscriptScroll } from '@/lib/transcript-scroll'
import {
  useTranscriptScroll,
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
    failedTurn,
    runOutcomes,
    attachmentStatus,
    attachmentRefreshKey,
    urlStatuses,
    pendingMessages,
  } = useConversationState()

  const loadOlderMessages = useMessageStore((state) => state.loadOlderMessages)
  const ensureMessageLoaded = useMessageStore((state) => state.ensureMessageLoaded)

  // Upward paging: the transcript holds its top row while the older page
  // prepends, so no position bookkeeping is needed here.
  const handleNearTop = useCallback(() => {
    if (!conversationId) return
    const cs = useMessageStore.getState().conversationStates[conversationId]
    if (!cs?.hasOlderMessages || cs.isLoadingOlder) return
    void loadOlderMessages(conversationId)
  }, [conversationId, loadOlderMessages])

  const {
    containerRef: messagesContainerRef,
    contentRef: transcriptContentRef,
    floorRef,
    handleScroll,
    showJumpToLatest,
    jumpToLatest,
    buttonLeft,
  } = useTranscriptScroll({ conversationId, messages, onNearTop: handleNearTop })
  // The rendered message window (screenshot export reads it)
  const messagesContentRef = useRef<HTMLDivElement>(null)

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
    handleDeleteFromHere,
    handleRegenerate,
    handleFork,
    handleExportAll,
    handleExportConversation,
    handleExportMessage,
  } = useMessageHandlers({ messagesContentRef })

  const handleExportStreamingConversation = useCallback(() => {
    void handleExportConversation(null)
  }, [handleExportConversation])

  // Failed turn actions. Retry answers the unanswered user message in place
  // (the window tail while a failed turn shows).
  const dismissFailedTurn = useMessageStore((state) => state.dismissFailedTurn)
  const showPreviousReply = useMessageStore((state) => state.showPreviousReply)
  const handleRetryFailedTurn = useCallback(() => {
    const tail = messages[messages.length - 1]
    if (tail?.sender_type === 'user') void handleRegenerate(tail.id)
  }, [messages, handleRegenerate])
  const handleDismissFailedTurn = useCallback(() => {
    if (conversationId) dismissFailedTurn(conversationId)
  }, [conversationId, dismissFailedTurn])
  const handleShowPreviousReply = useCallback(() => {
    if (conversationId) void showPreviousReply(conversationId)
  }, [conversationId, showPreviousReply])

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
          requestTranscriptScroll({
            conversationId,
            reason: 'search',
            messageId: targetMessageId,
            placement: { kind: 'center' },
            smooth: true,
          })
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
        data-transcript-scroll="true"
        className="flex-1 overflow-y-auto px-4 [overflow-anchor:none]"
        onScroll={handleScroll}
      >
        {/* Transcript content: rows, then the last-turn floor (sized by
            useTranscriptScroll; outside the exported message window). */}
        <div ref={transcriptContentRef} className="min-h-full flex flex-col">
          {messages.length === 0 && !isStreaming && !isWaitingForAI ? (
            // Distinguish "fetching the window" from "genuinely empty": without
            // the isLoading branch the empty state flashes for the duration of
            // every conversation switch.
            isLoading ? (
              <div className="flex flex-1 items-center justify-center text-muted-foreground">
                <p className="text-sm animate-pulse">{t('loadingMessages')}</p>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-muted-foreground">
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
              failedTurn={failedTurn}
              runOutcomes={runOutcomes}
              isStreaming={isStreaming}
              isLoadingOlder={isLoadingOlder || (hasOlderMessages && messages.length === 0)}
              revealAll={revealAll}
              messagesContentRef={messagesContentRef}
              getDisplayInfo={getDisplayInfo}
              getMessageDisplayInfo={getMessageDisplayInfo}
              onRetryFailedTurn={handleRetryFailedTurn}
              onDismissFailedTurn={handleDismissFailedTurn}
              onShowPreviousReply={handleShowPreviousReply}
              onCopy={handleCopy}
              onRevert={handleRevert}
              onDeleteFromHere={handleDeleteFromHere}
              onRegenerate={handleRegenerate}
              onFork={handleFork}
              onExportAll={handleExportAll}
              onExportConversation={handleExportConversation}
              onExportStreamingConversation={handleExportStreamingConversation}
              onExportMessage={handleExportMessage}
            />
          )}
          <div ref={floorRef} aria-hidden="true" className="shrink-0" />
        </div>
      </div>

      {/* Jump to latest */}
      <ScrollToBottomButton
        isVisible={showJumpToLatest}
        hasBadge={isStreaming || failedTurn?.kind === 'failed'}
        inputAreaHeight={inputAreaHeight}
        buttonLeft={buttonLeft}
        onScrollToBottom={jumpToLatest}
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

      <PermissionApprovalDialog />
    </div>
  )
}
