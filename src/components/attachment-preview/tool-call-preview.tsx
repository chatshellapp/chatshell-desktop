import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench, ChevronDown, ChevronUp, XCircle, Loader2, Plug, Braces, Ban } from 'lucide-react'
import type { ToolCall } from '@/types'
import { parseToolName } from '@/lib/tool-name'
import type { ParsedToolName } from '@/lib/tool-name'
import {
  getToolInputSummary,
  getMcpToolInputSummary,
  formatDuration,
  ToolOutputRenderer,
  CopyButton,
} from './tool-output-renderers'
import { MarkdownContent } from '@/components/markdown-content'
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
  'load_skill',
  'load_mcp_schema',
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

function isJsonLike(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function jsonCodeBlock(text: string): string {
  return '```json\n' + text + '\n```'
}

export function ToolCallPreview({
  toolCall,
  streamingToolCall,
  isStreaming = false,
}: ToolCallPreviewProps) {
  const { t } = useTranslation('tools')
  const [isExpanded, setIsExpanded] = useState(false)
  const [showRaw, setShowRaw] = useState(false)

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
  const formattedInput = useMemo(() => formatJson(toolInput), [toolInput])

  const hasInput = toolInput && toolInput !== '{}' && toolInput !== ''
  const hasOutput = rawOutput && rawOutput !== ''
  const hasError = error && error !== ''
  const canExpand = hasInput || hasOutput || hasError

  const isInProgress = isStreaming || status === 'running' || status === 'pending'
  const isBuiltin = parsed.type === 'builtin'
  const hasSpecializedRenderer = isBuiltin && SPECIALIZED_TOOLS.has(parsed.toolName)

  const inputSummary = useMemo(
    () =>
      isBuiltin
        ? getToolInputSummary(parsed.toolName, toolInput)
        : getMcpToolInputSummary(toolInput),
    [isBuiltin, parsed.toolName, toolInput]
  )
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
          {hasSpecializedRenderer && !showRaw ? (
            <>
              <ToolOutputRenderer
                toolName={parsed.toolName}
                toolInput={toolInput}
                toolOutput={toolOutput}
              />
              {hasError && (
                <div className="space-y-1">
                  <p className="text-xs text-red-500/80 uppercase tracking-wider">
                    {t('toolCallPreview.error')}
                  </p>
                  <pre className="text-xs text-red-400/80 leading-relaxed bg-red-500/10 rounded p-2 overflow-x-auto">
                    {error}
                  </pre>
                </div>
              )}
              {isInProgress && !hasOutput && !hasError && (
                <p className="text-xs text-muted-foreground/50 italic">
                  {t('toolCallPreview.waitingForResult')}
                </p>
              )}
            </>
          ) : (
            <>
              {hasInput && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground/70 uppercase tracking-wider">
                      {t('toolCallPreview.input')}
                    </p>
                    <CopyButton text={formattedInput} />
                  </div>
                  {isJsonLike(formattedInput) ? (
                    <div className="max-h-40 overflow-y-auto rounded">
                      <MarkdownContent
                        content={jsonCodeBlock(formattedInput)}
                        className="text-xs"
                      />
                    </div>
                  ) : (
                    <pre className="text-xs text-foreground/70 leading-relaxed bg-muted/30 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
                      {formattedInput}
                    </pre>
                  )}
                </div>
              )}
              {hasOutput && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground/70 uppercase tracking-wider">
                      {t('toolCallPreview.output')}
                    </p>
                    <CopyButton text={toolOutput} />
                  </div>
                  {showRaw ? (
                    <pre className="text-xs text-foreground/70 leading-relaxed bg-muted/30 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto">
                      {toolOutput}
                    </pre>
                  ) : (
                    <div className="max-h-60 overflow-y-auto rounded bg-muted/30 p-2">
                      <MarkdownContent content={toolOutput} className="text-xs" />
                    </div>
                  )}
                </div>
              )}
              {hasError && (
                <div className="space-y-1">
                  <p className="text-xs text-red-500/80 uppercase tracking-wider">
                    {t('toolCallPreview.error')}
                  </p>
                  <pre className="text-xs text-red-400/80 leading-relaxed bg-red-500/10 rounded p-2 overflow-x-auto">
                    {error}
                  </pre>
                </div>
              )}
              {isInProgress && !hasOutput && !hasError && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground/70 uppercase tracking-wider">
                    {t('toolCallPreview.output')}
                  </p>
                  <p className="text-xs text-muted-foreground/50 italic">
                    {t('toolCallPreview.waitingForResult')}
                  </p>
                </div>
              )}
            </>
          )}
          {(hasOutput || hasSpecializedRenderer) && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/30 transition-colors"
                title={showRaw ? t('toolCallPreview.showFormatted') : t('toolCallPreview.showRaw')}
              >
                <Braces className="h-3 w-3" />
                <span className="text-[10px]">
                  {showRaw ? t('toolCallPreview.formatted') : t('toolCallPreview.raw')}
                </span>
              </button>
            </div>
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
