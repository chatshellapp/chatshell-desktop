import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench, ChevronDown, ChevronUp, XCircle, Loader2, Plug, Ban } from 'lucide-react'
import type { ToolCall } from '@/types'
import { parseToolName } from '@/lib/tool-name'
import type { ParsedToolName } from '@/lib/tool-name'
import {
  getToolInputSummary,
  getMcpToolInputSummary,
  formatDuration,
  ToolOutputRenderer,
  McpToolOutput,
} from './tool-output-renderers'
import { DiffStatsBadge } from './diff-view'
import { diffStatCounts } from '@/lib/tool-diff'
import { humanizeToolError } from '@/lib/tool-errors'

import { getToolIconByName } from '@/components/builtin-tool-icon'

// Re-export StreamingToolCall from store types for consistency
export type { StreamingToolCall } from '@/stores/message/types'
import type { StreamingToolCall } from '@/stores/message/types'

interface ToolCallPreviewProps {
  toolCall?: ToolCall
  streamingToolCall?: StreamingToolCall
  isStreaming?: boolean
}

// Format JSON for display with proper indentation.
// Built-in tool outputs are JSON-encoded by rig (e.g. strings get wrapped in quotes
// with escaped newlines), so we parse them. If the parsed result is a plain string,
// return it directly to preserve real newlines. Only re-serialize objects/arrays.
function formatJson(jsonString: string | undefined): string {
  if (!jsonString) return ''
  try {
    const parsed = JSON.parse(jsonString)
    if (typeof parsed === 'string') return parsed
    return JSON.stringify(parsed, null, 2)
  } catch {
    return jsonString
  }
}

// Tools that use specialized output renderers instead of generic JSON display
const SPECIALIZED_TOOLS = new Set([
  'web_search',
  'web_fetch',
  'read',
  'skill',
  'mcp_schema',
  'bash',
  'kill_shell',
  'edit',
  'write',
  'grep',
  'glob',
])

function getToolIcon(parsed: ParsedToolName) {
  if (parsed.type === 'mcp') return Plug
  return getToolIconByName(parsed.toolName)
}

function StatusIcon({
  status,
  isStreaming,
  parsed,
}: {
  status: string
  isStreaming?: boolean
  parsed: ParsedToolName
}) {
  if (isStreaming || status === 'running' || status === 'pending') {
    return <Loader2 className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0 animate-spin" />
  }
  if (status === 'cancelled') {
    return <Ban className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />
  }
  if (status === 'error') {
    return <XCircle className="h-3.5 w-3.5 text-red-500/80 flex-shrink-0" />
  }
  if (status === 'success') {
    const Icon = getToolIcon(parsed)
    return <Icon className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0" />
  }
  return <Wrench className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0" />
}

export function ToolNameDisplay({ rawName }: { rawName: string }) {
  const parsed = parseToolName(rawName)

  if (parsed.type === 'builtin') {
    return (
      <span className="text-xs text-muted-foreground truncate font-mono">{parsed.toolName}</span>
    )
  }

  return (
    <span className="text-xs text-muted-foreground truncate font-mono">
      {parsed.serverName}/{parsed.toolName}
    </span>
  )
}

function ErrorBlock({ error }: { error: string }) {
  const { t } = useTranslation('tools')
  const message = humanizeToolError(error)
  const isHumanized = message !== error
  return (
    <div className="space-y-1" data-testid="tool-error">
      <p className="text-xs text-red-500/80 uppercase tracking-wider">
        {t('toolCallPreview.error')}
      </p>
      <div className="text-xs text-red-400/90 leading-relaxed bg-red-500/10 rounded p-2">
        <p className="whitespace-pre-wrap break-words">{message}</p>
        {isHumanized && (
          <details className="mt-1">
            <summary className="text-[10px] text-muted-foreground/60 cursor-pointer select-none">
              {t('toolCallPreview.rawErrorDetail')}
            </summary>
            <pre className="mt-1 text-xs text-red-400/70 whitespace-pre-wrap break-words overflow-x-auto">
              {error}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

export function ToolCallPreview({
  toolCall,
  streamingToolCall,
  isStreaming = false,
}: ToolCallPreviewProps) {
  const { t } = useTranslation('tools')
  const [isExpanded, setIsExpanded] = useState(false)

  const tc = toolCall || streamingToolCall
  if (!tc) return null

  const toolName = tc.tool_name
  const parsed = parseToolName(toolName)
  const toolInput = tc.tool_input
  const rawOutput = 'tool_output' in tc ? tc.tool_output : streamingToolCall?.tool_output
  const status = tc.status
  const error = 'error' in tc ? tc.error : streamingToolCall?.error
  const durationMs = toolCall?.duration_ms

  // Unwrap rig's JSON-encoded string outputs for built-in tools
  const toolOutput = useMemo(() => formatJson(rawOutput), [rawOutput])

  const hasInput = toolInput && toolInput !== '{}' && toolInput !== ''
  const hasOutput = rawOutput && rawOutput !== ''
  const hasError = error && error !== ''
  const canExpand = hasInput || hasOutput || hasError

  const isInProgress = isStreaming || status === 'running' || status === 'pending'
  const isBuiltin = parsed.type === 'builtin'
  const isMcp = parsed.type === 'mcp'
  const hasSpecializedRenderer = isBuiltin && SPECIALIZED_TOOLS.has(parsed.toolName)

  const inputSummary = useMemo(
    () =>
      isBuiltin
        ? getToolInputSummary(parsed.toolName, toolInput)
        : getMcpToolInputSummary(toolInput),
    [isBuiltin, parsed.toolName, toolInput]
  )
  const diffStats = useMemo(() => {
    if (!isBuiltin) return null
    try {
      const input = toolInput ? JSON.parse(toolInput) : {}
      if (parsed.toolName === 'edit') {
        return diffStatCounts(input.old_string ?? '', input.new_string ?? '')
      }
      if (parsed.toolName === 'write' && typeof input.content === 'string') {
        return { additions: input.content ? input.content.split('\n').length : 0, deletions: 0 }
      }
    } catch {
      // fall through to no badge
    }
    return null
  }, [isBuiltin, parsed.toolName, toolInput])
  const duration = formatDuration(durationMs)

  const containerClass = isExpanded
    ? 'w-full rounded border border-muted/50 bg-muted/20 overflow-hidden'
    : isInProgress
      ? 'w-fit max-w-full rounded border border-muted/40 bg-muted/30 overflow-hidden'
      : 'w-fit max-w-full rounded border border-transparent bg-muted/20 overflow-hidden'

  return (
    <div className={containerClass}>
      {/* Header row */}
      <button
        onClick={() => canExpand && setIsExpanded(!isExpanded)}
        className={`flex items-center gap-2 px-2.5 py-1.5 w-full min-w-0 text-left transition-colors ${
          canExpand ? 'hover:bg-muted/30 cursor-pointer' : 'cursor-default'
        }`}
      >
        <StatusIcon status={status} isStreaming={isInProgress} parsed={parsed} />

        <ToolNameDisplay rawName={toolName} />

        {diffStats && !isInProgress && (
          <DiffStatsBadge additions={diffStats.additions} deletions={diffStats.deletions} />
        )}
        {inputSummary && (
          <span className="text-xs text-muted-foreground/50 truncate min-w-0 font-mono">
            {inputSummary}
          </span>
        )}

        {duration && !isInProgress && (
          <span className="text-xs text-muted-foreground/40 flex-shrink-0">{duration}</span>
        )}

        {canExpand && (
          <span className="flex items-center text-muted-foreground/60 flex-shrink-0 ml-auto">
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
          {hasSpecializedRenderer ? (
            <ToolOutputRenderer
              toolName={parsed.toolName}
              toolInput={toolInput}
              toolOutput={toolOutput}
            />
          ) : isMcp ? (
            <McpToolOutput toolInput={toolInput} toolOutput={rawOutput} />
          ) : null}
          {hasError && <ErrorBlock error={error ?? ''} />}
          {isInProgress && !hasOutput && !hasError && (
            <p className="text-xs text-muted-foreground/50 italic">
              {t('toolCallPreview.waitingForResult')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function PendingToolCallPreview({ toolName }: { toolName: string }) {
  const { t } = useTranslation('tools')
  return (
    <div className="w-fit rounded bg-muted/30 border border-muted/40 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Loader2 className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0 animate-spin" />
        <ToolNameDisplay rawName={toolName} />
        <span className="text-xs text-muted-foreground/60">{t('toolCallPreview.calling')}</span>
      </div>
    </div>
  )
}
