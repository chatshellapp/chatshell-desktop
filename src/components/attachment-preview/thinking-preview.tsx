import { useState, useEffect } from 'react'
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

  // Auto-expand when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setIsExpanded(true)
    }
  }, [isStreaming])

  return (
    <div className="w-full rounded-lg border border-muted overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 text-left hover:bg-muted/30 transition-colors cursor-pointer"
      >
        <Lightbulb
          className={`h-4 w-4 text-muted-foreground flex-shrink-0 ${isStreaming ? 'animate-pulse' : ''}`}
        />

        <span className="flex-1 text-sm truncate">
          {isStreaming ? 'Thinking...' : 'Thought process'}
        </span>

        <span className="flex items-center gap-1.5 text-sm text-muted-foreground flex-shrink-0">
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {/* Expandable content */}
      {isExpanded && (
        <div className="border-t border-muted px-3 py-3 max-h-80 overflow-y-auto">
          <div className="text-sm text-foreground/80 leading-relaxed">
            {content ? (
              <MarkdownContent content={content} className="text-sm" />
            ) : isStreaming ? (
              <span className="text-muted-foreground/60 italic">Processing...</span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
