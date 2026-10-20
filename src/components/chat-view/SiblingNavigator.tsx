import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMessageStore } from '@/stores/message'
import { logger } from '@/lib/logger'

interface SiblingNavigatorProps {
  conversationId: string
  messageId: string
}

/**
 * `‹ i/N ›` branch switcher for message-tree sibling variants
 * (resend/regenerate alternates). Subscribes to the message store directly
 * so the surrounding memoized message rows do not re-render on branch
 * changes — only the navigators do.
 *
 * Renders nothing when the message has no siblings.
 */
function SiblingNavigator({ conversationId, messageId }: SiblingNavigatorProps) {
  const { t } = useTranslation('chat')
  const siblingGroups = useMessageStore(
    (state) => state.getConversationState(conversationId).siblingGroups
  )
  const messages = useMessageStore((state) => state.getConversationState(conversationId).messages)
  const isStreaming = useMessageStore(
    (state) => state.getConversationState(conversationId).isStreaming
  )
  const setActiveBranch = useMessageStore((state) => state.setActiveBranch)

  const parentKey = messages.find((m) => m.id === messageId)?.parent_id ?? ''
  const siblings = siblingGroups[parentKey]
  if (!siblings || siblings.length <= 1 || !siblings.includes(messageId)) {
    return null
  }

  const index = siblings.indexOf(messageId)

  return (
    <div className="flex items-center gap-0.5 text-xs text-muted-foreground select-none">
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0"
        disabled={isStreaming || index <= 0}
        onClick={() =>
          setActiveBranch(conversationId, siblings[index - 1]).catch((error) => {
            logger.error('Failed to switch sibling variant:', error)
          })
        }
        aria-label={t('previousVariant')}
      >
        <ChevronLeft className="h-3 w-3" />
      </Button>
      <span className="tabular-nums">
        {index + 1}/{siblings.length}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0"
        disabled={isStreaming || index >= siblings.length - 1}
        onClick={() =>
          setActiveBranch(conversationId, siblings[index + 1]).catch((error) => {
            logger.error('Failed to switch sibling variant:', error)
          })
        }
        aria-label={t('nextVariant')}
      >
        <ChevronRight className="h-3 w-3" />
      </Button>
    </div>
  )
}

export { SiblingNavigator }
