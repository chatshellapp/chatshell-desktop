import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useMessageStore } from '@/stores/message'
import { logger } from '@/lib/logger'
import { requestTranscriptScroll } from '@/lib/transcript-scroll'

interface SiblingNavigatorProps {
  conversationId: string
  messageId: string
}

/**
 * `‹ i/N ›` branch switcher for message-tree sibling variants
 * (resend/regenerate alternates). Hovering the counter explains what the
 * versions are. Subscribes to the message store directly
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

  // The selected sibling takes this one's on-screen position. Requested
  // before the switch so the current row can still be measured; the scroll
  // runs once the reloaded window renders the sibling.
  const switchTo = (siblingId: string) => {
    requestTranscriptScroll({
      conversationId,
      reason: 'branch',
      messageId: siblingId,
      placement: { kind: 'swap', fromId: messageId },
    })
    setActiveBranch(conversationId, siblingId).catch((error) => {
      logger.error('Failed to switch sibling variant:', error)
    })
  }

  return (
    <div className="flex items-center gap-0.5 text-xs text-muted-foreground select-none">
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0"
        disabled={isStreaming || index <= 0}
        onClick={() => switchTo(siblings[index - 1])}
        aria-label={t('previousVariant')}
      >
        <ChevronLeft className="h-3 w-3" />
      </Button>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex items-center gap-1 tabular-nums cursor-default"
              aria-label={t('versionOf', { current: index + 1, total: siblings.length })}
            >
              <GitBranch className="h-3 w-3" />
              {index + 1}/{siblings.length}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            <p className="font-medium">
              {t('versionOf', { current: index + 1, total: siblings.length })}
            </p>
            <p className="opacity-80">{t('versionsHint')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0"
        disabled={isStreaming || index >= siblings.length - 1}
        onClick={() => switchTo(siblings[index + 1])}
        aria-label={t('nextVariant')}
      >
        <ChevronRight className="h-3 w-3" />
      </Button>
    </div>
  )
}

export { SiblingNavigator }
