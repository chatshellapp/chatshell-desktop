import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message, UrlStatus } from '@/types'
import type { MessageResources } from '@/types/message-resources'
import { ApiErrorPreview } from './api-error-preview'
import { MessageItem } from './MessageItem'
import { StreamingMessage } from './StreamingMessage'
import type { DisplayInfo } from './hooks'

/** Rows in the first mounted chunk (app start, or the frame after a
 * conversation switch): roughly a screenful at the tail. */
const PROGRESSIVE_INITIAL = 16
/** Rows added per animation frame afterwards. */
const PROGRESSIVE_STEP = 16

interface MessageListProps {
  conversationId: string
  messages: Message[]
  /** Last user message in the window; the streaming row reads its resources. */
  lastUserMessage: Message | null
  showStreamingMessage: boolean
  messageResources: Record<string, MessageResources>
  urlStatuses: Record<string, Record<string, UrlStatus>>
  apiError: string | null
  isLoadingOlder: boolean
  /** Forces the whole window to mount in one commit (search jump to a row
   * outside the progressively mounted slice). */
  revealAll?: boolean
  messagesContentRef: RefObject<HTMLDivElement | null>
  messagesEndRef: RefObject<HTMLDivElement | null>
  getDisplayInfo: () => DisplayInfo
  getMessageDisplayInfo: (message: Message) => DisplayInfo
  onClearApiError: () => void
  onCopy: () => void
  onRevert: (messageId: string) => void
  onFork: (messageId: string) => void
  onExportAll: () => void
  onExportConversation: (messageId: string) => void
  /** Streaming-row export: pairs the last user message with the live row. */
  onExportStreamingConversation: () => void
  onExportMessage: (messageId: string) => void
}

/**
 * The rendered message window: history rows (memoized MessageItems), the
 * self-subscribing streaming row, error preview, and the scroll anchor.
 * Split from ChatView so the streaming-isolation render-count test can
 * exercise the list without the input area and IPC surface.
 *
 * Rows mount progressively from the tail. Re-entering a conversation with a
 * cached window resolves synchronously from the store, so the switch commit
 * must not mount heavy markdown rows: that blocks the paint and leaves the
 * PREVIOUS conversation's frame frozen on screen (measured 2026-10-19: the
 * 16-row first commit dominates the switch; unmounting the outgoing window
 * is cheap). The switch commit therefore mounts nothing and shows the
 * loading line; the growth effect below mounts the visible tail on the next
 * frame, one chunk per animation frame afterwards. Off-screen rows cost
 * little once mounted (content-visibility culling), and the pin in
 * useScrollBehavior keeps the viewport at the bottom while content grows.
 */
export function MessageList({
  conversationId,
  messages,
  lastUserMessage,
  showStreamingMessage,
  messageResources,
  urlStatuses,
  apiError,
  isLoadingOlder,
  revealAll = false,
  messagesContentRef,
  messagesEndRef,
  getDisplayInfo,
  getMessageDisplayInfo,
  onClearApiError,
  onCopy,
  onRevert,
  onFork,
  onExportAll,
  onExportConversation,
  onExportStreamingConversation,
  onExportMessage,
}: MessageListProps) {
  const { t } = useTranslation('chat')

  // Rows mounted for THIS conversation. Reset is derived during render (the
  // adjust-state-on-props pattern), so the first commit after a switch can
  // never reuse the previous conversation's larger count. The switch commit
  // mounts ZERO rows (cheap unmount of the outgoing view, fast paint of the
  // loading line); the growth effect below mounts the tail next frame.
  const [mount, setMount] = useState({ conversationId, count: PROGRESSIVE_INITIAL })
  const switched = mount.conversationId !== conversationId
  const mountedCount = switched ? 0 : mount.count
  const growing = !revealAll && mountedCount < messages.length
  const mounted = growing ? messages.slice(Math.max(0, messages.length - mountedCount)) : messages

  useEffect(() => {
    if (!growing) return
    const raf = requestAnimationFrame(() => {
      setMount({ conversationId, count: mountedCount + PROGRESSIVE_STEP })
    })
    return () => cancelAnimationFrame(raf)
  }, [growing, conversationId, mountedCount])

  return (
    <div ref={messagesContentRef} className="max-w-4xl mx-auto py-4">
      {mounted.length === 0 && messages.length > 0 && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm animate-pulse">{t('loadingMessages')}</p>
        </div>
      )}
      {isLoadingOlder && (
        <div className="py-2 text-center text-xs text-muted-foreground/60">
          {t('loadingEarlierMessages')}
        </div>
      )}
      {mounted.map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          prevUserMessage={
            index > 0 && mounted[index - 1].sender_type === 'user' ? mounted[index - 1] : null
          }
          messageResources={messageResources}
          urlStatuses={urlStatuses}
          getMessageDisplayInfo={getMessageDisplayInfo}
          onCopy={onCopy}
          onRevert={onRevert}
          onFork={onFork}
          onExportAll={onExportAll}
          onExportConversation={onExportConversation}
          onExportMessage={onExportMessage}
        />
      ))}
      {showStreamingMessage && (
        <div data-streaming-message="true">
          <StreamingMessage
            conversationId={conversationId}
            lastUserMessage={lastUserMessage}
            messageResources={messageResources}
            urlStatuses={urlStatuses}
            getDisplayInfo={getDisplayInfo}
            onCopy={onCopy}
            onExportAll={onExportAll}
            onExportConversation={onExportStreamingConversation}
            onExportMessage={() => {}}
          />
        </div>
      )}
      {/* API Error display */}
      {apiError && (
        <div className="py-2">
          <ApiErrorPreview error={apiError} onDismiss={onClearApiError} />
        </div>
      )}
      {/* Scroll anchor */}
      <div ref={messagesEndRef} />
    </div>
  )
}
