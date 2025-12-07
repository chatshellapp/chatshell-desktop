interface ScrollToBottomButtonProps {
  isVisible: boolean
  inputAreaHeight: number
  buttonLeft: string | number
  onScrollToBottom: () => void
}

export function ScrollToBottomButton({
  isVisible,
  inputAreaHeight,
  buttonLeft,
  onScrollToBottom,
}: ScrollToBottomButtonProps) {
  return (
    <div
      className={`fixed z-20 pointer-events-none transition-opacity duration-150 ease-in-out ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{
        bottom: `${inputAreaHeight + 16}px`,
        left: typeof buttonLeft === 'number' ? `${buttonLeft}px` : buttonLeft,
        transform: typeof buttonLeft === 'number' ? 'translateX(-50%)' : '-translate-x-1/2',
      }}
    >
      <button
        onClick={onScrollToBottom}
        className={`bg-muted text-muted-foreground px-2.5 py-1 rounded-full shadow-sm hover:bg-muted/90 transition-colors flex items-center gap-1.5 pointer-events-auto text-xs ${
          isVisible ? '' : 'pointer-events-none'
        }`}
      >
        <span className="text-sm">↓</span>
        <span>New messages</span>
      </button>
    </div>
  )
}

