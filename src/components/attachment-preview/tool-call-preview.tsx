import { useState } from 'react'
import { Wrench, ChevronDown, ChevronUp, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import type { ToolCall } from '@/types'

// Re-export StreamingToolCall from store types for consistency
export type { StreamingToolCall } from '@/stores/message/types'
import type { StreamingToolCall } from '@/stores/message/types'

interface ToolCallPreviewProps {
  // Either a saved ToolCall from DB or a streaming one
  toolCall?: ToolCall
  streamingToolCall?: StreamingToolCall
  isStreaming?: boolean
}

// Format JSON for display with proper indentation
function formatJson(jsonString: string | undefined): string {
  if (!jsonString) return ''
  try {
    const parsed = JSON.parse(jsonString)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return jsonString
  }
}

// Get status icon based on tool call status
function StatusIcon({ status, isStreaming }: { status: string; isStreaming?: boolean }) {
  if (isStreaming || status === 'running' || status === 'pending') {
    return <Loader2 className="h-3.5 w-3.5 text-blue-500/80 flex-shrink-0 animate-spin" />
  }
  if (status === 'success') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500/80 flex-shrink-0" />
  }
  if (status === 'error') {
    return <XCircle className="h-3.5 w-3.5 text-red-500/80 flex-shrink-0" />
  }
  return <Wrench className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0" />
}

// Get status text for display
function getStatusText(status: string, isStreaming?: boolean): string {
  if (isStreaming || status === 'running') return 'Running...'
  if (status === 'pending') return 'Pending'
  if (status === 'success') return 'Completed'
  if (status === 'error') return 'Failed'
  return status
}

export function ToolCallPreview({
  toolCall,
  streamingToolCall,
  isStreaming = false,
}: ToolCallPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Use either saved or streaming tool call
  const tc = toolCall || streamingToolCall
  if (!tc) return null

  const toolName = tc.tool_name
  const toolInput = tc.tool_input
  const toolOutput = 'tool_output' in tc ? tc.tool_output : streamingToolCall?.tool_output
  const status = tc.status
  const error = 'error' in tc ? tc.error : streamingToolCall?.error

  // Check if we have content to show
  const hasInput = toolInput && toolInput !== '{}' && toolInput !== ''
  const hasOutput = toolOutput && toolOutput !== ''
  const hasError = error && error !== ''
  const canExpand = hasInput || hasOutput || hasError

  // Determine if this is still in progress
  const isInProgress = isStreaming || status === 'running' || status === 'pending'

  // Dynamic container styles based on state
  const containerClass = isExpanded
    ? 'w-full rounded border border-muted/50 bg-muted/20 overflow-hidden'
    : isInProgress
      ? 'w-fit rounded border border-muted/40 bg-muted/30 overflow-hidden'
      : 'w-fit rounded border border-transparent bg-muted/20 overflow-hidden'

  return (
    <div className={containerClass}>
      {/* Header row */}
      <button
        onClick={() => canExpand && setIsExpanded(!isExpanded)}
        className={`flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
          canExpand ? 'hover:bg-muted/30 cursor-pointer' : 'cursor-default'
        }`}
      >
        <StatusIcon status={status} isStreaming={isInProgress} />

        <span className="text-xs text-muted-foreground truncate font-mono">{toolName}</span>

        <span className="text-xs text-muted-foreground/60 flex-shrink-0">
          {getStatusText(status, isInProgress)}
        </span>

        {canExpand && (
          <span className="flex items-center text-muted-foreground/60 flex-shrink-0">
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </span>
        )}
      </button>

      {/* Expandable content */}
      {isExpanded && canExpand && (
        <div className="border-t border-muted/50 px-2.5 py-2.5 space-y-2.5">
          {/* Input */}
          {hasInput && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground/70 uppercase tracking-wider">Input</p>
              <pre className="text-xs text-foreground/70 leading-relaxed bg-muted/30 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
                {formatJson(toolInput)}
              </pre>
            </div>
          )}

          {/* Output */}
          {hasOutput && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground/70 uppercase tracking-wider">Output</p>
              <pre className="text-xs text-foreground/70 leading-relaxed bg-muted/30 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto">
                {formatJson(toolOutput)}
              </pre>
            </div>
          )}

          {/* Error */}
          {hasError && (
            <div className="space-y-1">
              <p className="text-xs text-red-500/80 uppercase tracking-wider">Error</p>
              <pre className="text-xs text-red-400/80 leading-relaxed bg-red-500/10 rounded p-2 overflow-x-auto">
                {error}
              </pre>
            </div>
          )}

          {/* Loading state for output */}
          {isInProgress && !hasOutput && !hasError && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground/70 uppercase tracking-wider">Output</p>
              <p className="text-xs text-muted-foreground/50 italic">Waiting for result...</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Pending tool call preview - shown while waiting for tool to start
export function PendingToolCallPreview({ toolName }: { toolName: string }) {
  return (
    <div className="w-fit rounded bg-muted/30 border border-muted/40 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Loader2 className="h-3.5 w-3.5 text-blue-500/80 flex-shrink-0 animate-spin" />
        <span className="text-xs text-muted-foreground font-mono">{toolName}</span>
        <span className="text-xs text-muted-foreground/60">Calling...</span>
      </div>
    </div>
  )
}
