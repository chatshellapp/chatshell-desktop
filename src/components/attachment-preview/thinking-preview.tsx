import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Lightbulb, ChevronDown, ChevronUp } from 'lucide-react'
import { MarkdownContent } from '@/components/markdown-content'

/** Distance from the end that still counts as "at the bottom". */
const BOTTOM_TOLERANCE_PX = 4
/** Keys that move the thinking content upward when it has focus. */
const SCROLL_UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])

// ThinkingPreview component - displays AI's reasoning/thinking process
export function ThinkingPreview({
  content,
  isStreaming = false,
  defaultExpanded,
}: {
  content: string
  /** Whether thinking is still in progress (streaming) */
  isStreaming?: boolean
  /** Override initial expanded state (useful for completed segments that should stay visible) */
  defaultExpanded?: boolean
}) {
  const { t } = useTranslation('attachments')
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? isStreaming)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Whether streamed thinking keeps the content pinned to its end. Upward
  // input stops following at once; reaching the end again resumes it.
  const followRef = useRef(true)
  const lastScrollTopRef = useRef(0)

  // Only the inner container is ever written: scrollIntoView also scrolled
  // the transcript, and its smooth animation fought the reader's wheel.
  const scrollToEnd = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
    lastScrollTopRef.current = container.scrollTop
  }, [])

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const scrollTop = container.scrollTop
    const lastScrollTop = lastScrollTopRef.current
    lastScrollTopRef.current = scrollTop
    const distance = container.scrollHeight - scrollTop - container.clientHeight
    // Bottom first: macOS elastic overscroll overshoots past the end and then
    // moves back up, which must not count as scrolling up.
    if (distance <= BOTTOM_TOLERANCE_PX) {
      followRef.current = true
    } else if (scrollTop < lastScrollTop) {
      // Scrollbar dragging and any other upward movement
      followRef.current = false
    }
  }, [])

  // Upward wheel/trackpad intent stops following immediately, even for
  // deltas that stay within the bottom tolerance.
  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) followRef.current = false
  }, [])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (SCROLL_UP_KEYS.has(event.key)) followRef.current = false
  }, [])

  // Auto-expand when streaming starts, following from the end
  useEffect(() => {
    if (isStreaming) {
      setIsExpanded(true)
      followRef.current = true
    }
  }, [isStreaming])

  // Re-expanding starts at the end again
  useLayoutEffect(() => {
    if (isExpanded) followRef.current = true
  }, [isExpanded])

  // Keep the end in view as thinking streams in, before paint
  useLayoutEffect(() => {
    if (!isStreaming || !isExpanded || !followRef.current) return
    scrollToEnd()
  }, [content, isStreaming, isExpanded, scrollToEnd])

  // Dynamic container styles based on state
  const containerClass = isExpanded
    ? 'w-full rounded border border-muted/50 bg-muted/20 overflow-hidden'
    : isStreaming
      ? 'w-fit rounded border border-muted/40 bg-muted/30 overflow-hidden'
      : 'w-fit rounded border border-transparent bg-muted/20 overflow-hidden'

  return (
    <div className={containerClass}>
      {/* Header row */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/30 transition-colors cursor-pointer"
      >
        <Lightbulb
          className={`h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0 ${isStreaming ? 'animate-pulse' : ''}`}
        />

        <span className="text-xs text-muted-foreground truncate">
          {isStreaming ? t('thinking') : t('thoughtProcess')}
        </span>

        <span className="flex items-center text-muted-foreground/60 flex-shrink-0">
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {/* Expandable content */}
      {isExpanded && (
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          className="border-t border-muted/50 px-2.5 py-2.5 max-h-80 overflow-y-auto"
        >
          <div className="text-xs text-foreground/70 leading-relaxed">
            {content ? (
              <MarkdownContent content={content} className="text-xs" />
            ) : isStreaming ? (
              <span className="text-muted-foreground/50 italic">{t('processing')}</span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
