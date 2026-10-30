import { ArrowDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ScrollToBottomButtonProps {
  isVisible: boolean
  /** Dot for "the end is changing" (streaming) or "something failed there". */
  hasBadge: boolean
  inputAreaHeight: number
  buttonLeft: string | number
  onScrollToBottom: () => void
}

/** Jump-to-latest pill, shown while the end of the transcript is out of
 * view. Jumping scrolls once; it does not start following the stream. */
export function ScrollToBottomButton({
  isVisible,
  hasBadge,
  inputAreaHeight,
  buttonLeft,
  onScrollToBottom,
}: ScrollToBottomButtonProps) {
  const { t } = useTranslation('chat')
  return (
    <div
      className={`fixed z-20 pointer-events-none transition-opacity duration-150 ease-in-out ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{
        bottom: `${inputAreaHeight + 16}px`,
        left: typeof buttonLeft === 'number' ? `${buttonLeft}px` : buttonLeft,
        transform: 'translateX(-50%)',
      }}
    >
      <button
        onClick={onScrollToBottom}
        aria-label={t('jumpToLatest')}
        tabIndex={isVisible ? 0 : -1}
        className={`relative bg-muted text-muted-foreground px-2.5 py-1 rounded-full shadow-sm hover:bg-muted/90 transition-colors flex items-center gap-1.5 text-xs ${
          isVisible ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
      >
        <ArrowDown className="h-3.5 w-3.5" />
        <span>{t('jumpToLatest')}</span>
        {hasBadge && (
          <span
            data-testid="jump-badge"
            className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary"
          />
        )}
      </button>
    </div>
  )
}
