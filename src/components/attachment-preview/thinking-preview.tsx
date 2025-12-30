import { useState, useEffect, useRef, useCallback } from 'react'
import { Lightbulb, ChevronDown, ChevronUp } from 'lucide-react'
import { MarkdownContent } from '@/components/markdown-content'

// ThinkingPreview component - displays AI's reasoning/thinking process
export function ThinkingPreview({
  content,
  isStreaming = false,
}: {
  content: string
  /** Whether thinking is still in progress (streaming) */
  isStreaming?: boolean
}) {
  // Auto-expand when streaming to show live thinking
  const [isExpanded, setIsExpanded] = useState(isStreaming)

  // Refs for auto-scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const contentEndRef = useRef<HTMLDivElement>(null)

  // Track if user is at bottom of the thinking container
  const [isAtBottom, setIsAtBottom] = useState(true)
  const isUserScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<number | null>(null)

  // Check if user is near bottom (within 50px threshold)
  const checkIfAtBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return true

    const threshold = 50
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold

    return isNearBottom
  }, [])

  // Handle scroll events to track user position
  const handleScroll = useCallback(() => {
    isUserScrollingRef.current = true

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    scrollTimeoutRef.current = window.setTimeout(() => {
      isUserScrollingRef.current = false
      setIsAtBottom(checkIfAtBottom())
    }, 150)
  }, [checkIfAtBottom])

  // Auto-expand when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setIsExpanded(true)
    }
  }, [isStreaming])

  // Auto-scroll to bottom when content changes while streaming
  useEffect(() => {
    if (!isStreaming || !isExpanded || isUserScrollingRef.current) {
      return
    }

    if (isAtBottom && contentEndRef.current) {
      contentEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [content, isStreaming, isExpanded, isAtBottom])

  // Reset scroll position when streaming starts
  useEffect(() => {
    if (isStreaming && isExpanded) {
      setIsAtBottom(true)
      isUserScrollingRef.current = false
    }
  }, [isStreaming, isExpanded])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

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
          {isStreaming ? 'Thinking...' : 'Thought process'}
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
          className="border-t border-muted/50 px-2.5 py-2.5 max-h-80 overflow-y-auto"
        >
          <div className="text-xs text-foreground/70 leading-relaxed">
            {content ? (
              <MarkdownContent content={content} className="text-xs" />
            ) : isStreaming ? (
              <span className="text-muted-foreground/50 italic">Processing...</span>
            ) : null}
          </div>
          {/* Scroll anchor */}
          <div ref={contentEndRef} />
        </div>
      )}
    </div>
  )
}
