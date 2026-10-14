import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message, UrlStatus } from '@/types'
import type { MessageResources } from '@/types/message-resources'
import { ApiErrorPreview } from './api-error-preview'
import { MessageItem } from './MessageItem'
import { StreamingMessage } from './StreamingMessage'
import type { DisplayInfo } from './hooks'

/** Rows mounted in the first (cheap) commit: roughly a screenful at the tail. */
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
 * Rows mount progressively from the tail: switching into a conversation with
 * a cached window must not mount ~100 heavy markdown rows in one synchronous
 * commit — that blocks the paint and leaves the previous conversation's frame
 * on screen until the commit finishes. The first commit mounts only the
 * visible tail; one chunk joins per animation frame afterwards. Off-screen
 * rows cost little once mounted (content-visibility culling), and the pin
 * below keeps the viewport at the bottom while content grows above it.
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
  // never reuse the previous conversation's larger count.
  const [mount, setMount] = useState({ conversationId, count: PROGRESSIVE_INITIAL })
  const mountedCount = mount.conversationId === conversationId ? mount.count : PROGRESSIVE_INITIAL
  const growing = !revealAll && mountedCount < messages.length
  const mounted = growing ? messages.slice(-mountedCount) : messages

  useEffect(() => {
    if (!growing) return
    const raf = requestAnimationFrame(() => {
      setMount({ conversationId, count: mountedCount + PROGRESSIVE_STEP })
    })
    return () => cancelAnimationFrame(raf)
  }, [growing, conversationId, mountedCount])

  return (
    <div ref={messagesContentRef} className="max-w-4xl mx-auto py-4">
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
