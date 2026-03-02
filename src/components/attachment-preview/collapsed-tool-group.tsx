import { useState } from 'react'
import { ChevronDown, ChevronUp, Layers } from 'lucide-react'
import type { ToolWithThinking } from '@/lib/step-grouping'
import { ThinkingPreview } from './thinking-preview'
import { ToolCallPreview } from './tool-call-preview'

interface CollapsedToolGroupProps {
  items: ToolWithThinking[]
}

export function CollapsedToolGroup({ items }: CollapsedToolGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const toolCounts = items.reduce(
    (acc, item) => {
      const name = item.toolCall.tool_name
      acc[name] = (acc[name] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  const summary = Object.entries(toolCounts)
    .map(([name, count]) => (count > 1 ? `${name} \u00d7${count}` : name))
    .join(', ')

  const containerClass = isExpanded
    ? 'w-full rounded border border-muted/50 bg-muted/20 overflow-hidden'
    : 'w-fit rounded border border-transparent bg-muted/20 overflow-hidden'

  return (
    <div className={containerClass}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/30 transition-colors cursor-pointer"
      >
        <Layers className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0" />

        <span className="text-xs text-muted-foreground">Ran {items.length} steps</span>

        <span className="text-xs text-muted-foreground/60 truncate">{summary}</span>

        <span className="flex items-center text-muted-foreground/60 flex-shrink-0">
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-muted/50 px-2 py-2 space-y-1">
          {items.map((item) => (
            <div key={item.toolCall.id} className="space-y-1">
              {item.thinkingContent && <ThinkingPreview content={item.thinkingContent} />}
              <ToolCallPreview toolCall={item.toolCall} />
              {item.trailingThinkingContent && (
                <ThinkingPreview content={item.trailingThinkingContent} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
