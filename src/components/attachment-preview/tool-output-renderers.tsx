import { useMemo, useState } from 'react'
import { ExternalLink, Copy, Check } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import Ansi from 'ansi-to-react'
import { MarkdownContent } from '@/components/markdown-content'
import { getDomain } from './utils'
import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import { DiffView } from './diff-view'
import {
  parseReadOutput,
  isReadGap,
  countGrepMatches,
  grepFilePaths,
} from '@/lib/tool-output-parse'

function useCopyButton(text: string) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return { copied, handleCopy }
}

export function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation('tools')
  const { copied, handleCopy } = useCopyButton(text)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        handleCopy()
      }}
      className="p-1 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      title={t('copyButton.copy')}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

// --- Input summary extraction ---

function extractCommandNames(command: string): string {
  let stripped = command.replace(/<<-?\s*'?\w+'?[\s\S]*/, '')

  // Neutralize quoted string contents so we don't split on ; | && inside them
  stripped = stripped.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''")
  stripped = stripped.replace(/`[^`]*`/g, '``')

  // Neutralize array assignments: VAR=( ... ) → VAR=()
  stripped = stripped.replace(/=\([^)]*\)/g, '=()')

  const SHELL_KEYWORDS = new Set([
    'do',
    'done',
    'then',
    'else',
    'elif',
    'fi',
    'esac',
    'in',
    'function',
    'time',
    'coproc',
    'if',
  ])
  const LOOP_HEADERS = new Set(['for', 'while', 'until', 'case', 'select'])

  const names = stripped
    .split(/\s*(?:&&|\|\||[|;])\s*/)
    .map((segment) => {
      const trimmed = segment.trim()
      if (!trimmed) return null
      const parts = trimmed.split(/\s+/)
      for (const part of parts) {
        if (part.includes('=') || part === 'sudo' || part === 'env') continue
        if (part === '>' || part === '>>' || part === '<' || part === '2>') return null
        if (LOOP_HEADERS.has(part)) return null
        if (SHELL_KEYWORDS.has(part)) continue
        if (/^["'`()[\]{}$\\-]/.test(part)) continue
        if (/^\d/.test(part)) continue
        return part.replace(/^.*\//, '')
      }
      return null
    })
    .filter((n): n is string => n !== null)

  const deduped = names.filter((n, i) => i === 0 || n !== names[i - 1])
  return deduped.join(', ')
}

function fileNameFromPath(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

export function getToolInputSummary(toolName: string, toolInput?: string): string | null {
  if (!toolInput) return null
  try {
    const parsed = JSON.parse(toolInput)
    switch (toolName) {
      case 'read':
        return parsed.path ? fileNameFromPath(parsed.path) : null
      case 'edit':
      case 'write':
        return parsed.path ? fileNameFromPath(parsed.path) : null
      case 'skill':
        return parsed.name ?? null
      case 'mcp_schema':
        return parsed.server && parsed.tool ? `${parsed.server}/${parsed.tool}` : null
      case 'bash':
        return parsed.description || (parsed.command ? extractCommandNames(parsed.command) : null)
      case 'kill_shell':
        return i18n.t('toolInput.killShellSummary', { ns: 'tools' })
      case 'web_search':
        return parsed.query || null
      case 'web_fetch':
        return parsed.url ? getDomain(parsed.url) : null
      case 'glob':
        return parsed.pattern || null
      case 'grep':
        return parsed.pattern ?? null
      default:
        return null
    }
  } catch {
    return null
  }
}

const WELL_KNOWN_PARAMS = ['query', 'path', 'url', 'input', 'prompt', 'command', 'name', 'message']

function truncateSummary(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\u2026' : s
}

export function getMcpToolInputSummary(toolInput?: string): string | null {
  if (!toolInput) return null
  try {
    const parsed = JSON.parse(toolInput)
    if (typeof parsed !== 'object' || parsed === null) return null

    for (const key of WELL_KNOWN_PARAMS) {
      if (typeof parsed[key] === 'string' && parsed[key].length > 0) {
        return truncateSummary(parsed[key], 80)
      }
    }

    let best: string | null = null
    for (const value of Object.values(parsed)) {
      if (typeof value === 'string' && value.length > 0 && value.length <= 120) {
        if (best === null || value.length > best.length) {
          best = value
        }
      }
    }
    return best ? truncateSummary(best, 80) : null
  } catch {
    return null
  }
}

// --- Duration formatting ---

export function formatDuration(ms?: number): string | null {
  if (ms == null) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// --- Tool-specific output renderers ---

interface ToolOutputProps {
  toolInput?: string
  toolOutput?: string
}

export function WebSearchOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const query = safeParseField(toolInput, 'query') || ''
  const output = toolOutput || ''

  return (
    <div className="space-y-1">
      {query && (
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="text-xs text-muted-foreground/50 truncate">"{query}"</span>
          {output && <CopyButton text={output} />}
        </div>
      )}
      {output && (
        <div className="max-h-60 overflow-y-auto rounded bg-muted/30 p-2">
          <MarkdownContent content={output} flat className="text-xs text-foreground/80" />
        </div>
      )}
    </div>
  )
}

export function WebFetchOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const { t } = useTranslation('tools')
  const url = safeParseField(toolInput, 'url')
  const domain = url ? getDomain(url) : null
  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : null

  return (
    <div className="space-y-1">
      {url && (
        <div className="flex items-center gap-2 min-w-0">
          {faviconUrl && (
            <img
              src={faviconUrl}
              alt=""
              className="h-3.5 w-3.5 rounded-sm flex-shrink-0"
              onError={(e) => {
                const img = e.target as HTMLImageElement
                img.style.display = 'none'
              }}
            />
          )}
          <span className="text-xs text-muted-foreground/50 font-mono truncate flex-1 min-w-0">
            {url}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              openUrl(url)
            }}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0"
            title={t('webFetch.openInBrowser')}
          >
            <ExternalLink className="h-3 w-3" />
          </button>
          {toolOutput && <CopyButton text={toolOutput} />}
        </div>
      )}
      {toolOutput && (
        <div className="max-h-60 overflow-y-auto rounded bg-muted/30 p-2">
          <MarkdownContent content={toolOutput} flat className="text-xs text-foreground/80" />
        </div>
      )}
    </div>
  )
}

export function ReadOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const path = safeParseField(toolInput, 'path') || ''
  const output = toolOutput || ''

  const parsed = useMemo(() => parseReadOutput(output), [output])
  const numberedCount = parsed.lines.filter((l) => l.n !== null).length
  // The backend prefixes every line of a text read with "N\t"; anything else
  // (images, notes, unprefixed text) keeps the generic pre fallback.
  const hasRealLineNumbers = parsed.lines.length > 0 && numberedCount === parsed.lines.length

  const maxLineNo = parsed.lines.reduce((max, l) => Math.max(max, l.n ?? 0), 0)
  const gutterWidth = `${Math.max(2, String(maxLineNo).length)}ch`

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-xs text-muted-foreground/50 font-mono truncate">{path}</span>
        {output && <CopyButton text={parsed.lines.map((l) => l.text).join('\n')} />}
      </div>
      {hasRealLineNumbers ? (
        <div className="rounded border border-muted/50 overflow-hidden font-mono text-xs">
          <div className="overflow-x-auto max-h-60 overflow-y-auto" data-testid="read-gutter">
            {parsed.lines.map((line, i) => {
              const prev = parsed.lines[i - 1]
              const gapBefore = prev ? isReadGap(prev, line) : false
              return (
                <div key={i}>
                  {gapBefore && (
                    <div
                      className="text-muted-foreground/40 select-none px-2"
                      data-testid="read-gap"
                    >
                      …
                    </div>
                  )}
                  <div className="flex items-start hover:bg-muted/30">
                    <span
                      className="flex-shrink-0 text-right text-muted-foreground/40 select-none px-1"
                      style={{ width: gutterWidth }}
                    >
                      {line.n ?? ''}
                    </span>
                    <span className="flex-1 whitespace-pre pr-3 text-foreground/80">
                      {line.text || ' '}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          {parsed.footer && (
            <div className="px-2 py-1 bg-muted/30 text-muted-foreground/50 border-t border-muted/40">
              {parsed.footer}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded border border-muted/50 overflow-hidden font-mono text-xs">
          <pre className="overflow-x-auto max-h-60 overflow-y-auto p-2 text-foreground/80 whitespace-pre-wrap break-words">
            {output}
          </pre>
        </div>
      )}
    </div>
  )
}

export function BashOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const { t } = useTranslation('tools')
  const command = safeParseField(toolInput, 'command') || ''
  const output = toolOutput || ''

  // Parse exit code if present: "[exit code: N]\n..."
  let exitCode: number | null = null
  let cleanOutput = output
  const exitMatch = output.match(/^\[exit code: (\d+)\]\n?/)
  if (exitMatch) {
    exitCode = parseInt(exitMatch[1], 10)
    cleanOutput = output.slice(exitMatch[0].length)
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-end gap-2">
        {exitCode !== null && exitCode !== 0 && (
          <span className="text-xs text-red-400/80 flex-shrink-0 mr-auto">
            {t('bashOutput.exitCode', { exitCode })}
          </span>
        )}
        {cleanOutput && <CopyButton text={cleanOutput} />}
      </div>
      <div className="rounded bg-zinc-900 dark:bg-zinc-950 max-h-60 overflow-y-auto p-2.5">
        {command && (
          <div className="text-xs font-mono text-green-400/80 mb-1.5 break-all">$ {command}</div>
        )}
        {cleanOutput && (
          <pre
            className="text-xs font-mono text-zinc-300 whitespace-pre-wrap break-all leading-relaxed"
            data-testid="bash-output"
          >
            <Ansi>{cleanOutput}</Ansi>
          </pre>
        )}
      </div>
    </div>
  )
}

export function EditOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const oldStr = safeParseField(toolInput, 'old_string') ?? ''
  const newStr = safeParseField(toolInput, 'new_string') ?? ''
  // Caption: backend success line ("Successfully replaced N occurrence(s) in ...")
  const caption = toolOutput?.split('\n')[0] || ''

  return (
    <div className="space-y-1">
      {caption && (
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="text-xs text-muted-foreground/50 truncate">{caption}</span>
          {newStr && <CopyButton text={newStr} />}
        </div>
      )}
      <DiffView oldText={oldStr} newText={newStr} />
    </div>
  )
}

export function WriteOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const content = safeParseField(toolInput, 'content') ?? ''
  // Caption: backend success line ("Created/Wrote <path> (N lines, M bytes)")
  const caption = toolOutput?.split('\n')[0] || ''

  return (
    <div className="space-y-1">
      {caption && (
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="text-xs text-muted-foreground/50 truncate">{caption}</span>
          {content && <CopyButton text={content} />}
        </div>
      )}
      <DiffView oldText="" newText={content} />
    </div>
  )
}

export function SimpleTextOutput({ toolOutput }: ToolOutputProps) {
  if (!toolOutput) return null
  return <p className="text-xs text-muted-foreground/70 leading-relaxed">{toolOutput}</p>
}

export function GrepOutput({ toolOutput }: ToolOutputProps) {
  const { t } = useTranslation('tools')
  const output = toolOutput || ''

  const matchCount = useMemo(() => (output ? countGrepMatches(output) : 0), [output])
  const fileCount = useMemo(() => (output ? grepFilePaths(output).length : 0), [output])

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-xs text-muted-foreground/50 font-mono truncate">
          {matchCount} {matchCount === 1 ? t('grepOutput.match') : t('grepOutput.matches')} ·{' '}
          {fileCount} {fileCount === 1 ? t('grepOutput.file') : t('grepOutput.files')}
        </span>
        {output && <CopyButton text={output} />}
      </div>
      <pre className="text-xs text-foreground/80 leading-relaxed bg-muted/30 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto font-mono">
        {output}
      </pre>
    </div>
  )
}

export function GlobOutput({ toolOutput }: ToolOutputProps) {
  const { t } = useTranslation('tools')
  const output = toolOutput || ''
  const files = output.split('\n').filter(Boolean)
  const fileCount = files.length

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-xs text-muted-foreground/50">
          {fileCount} {fileCount === 1 ? t('globOutput.file') : t('globOutput.files')}
        </span>
        {output && <CopyButton text={output} />}
      </div>
      <pre className="text-xs text-foreground/70 leading-relaxed bg-muted/30 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto font-mono">
        {output}
      </pre>
    </div>
  )
}

/**
 * Normalize SKILL.md so that YAML frontmatter (between ---) is rendered as a markdown
 * code block instead of raw lines. This way the full document is still one markdown
 * stream: metadata appears as ```yaml ... ``` and the rest renders normally.
 */
function normalizeSkillMarkdown(content: string): string {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) {
    return content
  }
  const afterOpening = trimmed.slice(3)
  const endIdx = afterOpening.indexOf('\n---')
  if (endIdx === -1) {
    return content
  }
  const frontmatter = afterOpening.slice(0, endIdx).trim()
  const body = afterOpening.slice(endIdx + 4).trim()
  const codeBlock = '```yaml\n' + frontmatter + '\n```\n\n'
  return codeBlock + body
}

function stripXmlWrapper(content: string, tag: string): string {
  const openRe = new RegExp(`^<${tag}\\b[^>]*>\\n?`)
  const closeRe = new RegExp(`\\n?</${tag}>$`)
  return content.replace(openRe, '').replace(closeRe, '')
}

function stripXmlBlock(content: string, tag: string): string {
  return content.replace(new RegExp(`\\n?<${tag}>[\\s\\S]*?<\\/${tag}>`, 'g'), '')
}

export function SkillOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const name = safeParseField(toolInput, 'name') || ''
  const raw = toolOutput || ''
  const unwrapped = stripXmlWrapper(raw, 'skill_content')
  const stripped = unwrapped ? stripXmlBlock(unwrapped, 'skill_resources') : unwrapped
  const content = stripped ? normalizeSkillMarkdown(stripped) : ''

  return (
    <div className="space-y-1">
      {name && (
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="text-xs text-muted-foreground/50 truncate min-w-0">{name}</span>
          {raw && <CopyButton text={stripped} />}
        </div>
      )}
      {content && (
        <div className="max-h-60 overflow-y-auto rounded bg-muted/30 p-2">
          <MarkdownContent content={content} flat className="text-xs text-foreground/80" />
        </div>
      )}
    </div>
  )
}

export function McpSchemaOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const server = safeParseField(toolInput, 'server') || ''
  const tool = safeParseField(toolInput, 'tool') || ''
  const label = server && tool ? `${server}/${tool}` : ''
  const raw = toolOutput || ''
  const unwrapped = stripXmlWrapper(raw, 'mcp_schema')

  if (!unwrapped) return null

  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(unwrapped), null, 2)
    } catch {
      return unwrapped
    }
  }, [unwrapped])

  return (
    <div className="space-y-1">
      {label && (
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="text-xs text-muted-foreground/50 truncate min-w-0">{label}</span>
          {raw && <CopyButton text={unwrapped} />}
        </div>
      )}
      <div className="rounded border border-muted/50 overflow-hidden font-mono text-xs">
        <pre className="overflow-x-auto max-h-60 overflow-y-auto p-2 text-foreground/80 whitespace-pre">
          {pretty}
        </pre>
      </div>
    </div>
  )
}

export function McpToolOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const { t } = useTranslation('tools')
  const args = useMemo(() => {
    if (!toolInput) return null
    try {
      const parsed = JSON.parse(toolInput)
      if (typeof parsed !== 'object' || parsed === null) return null
      return parsed as Record<string, unknown>
    } catch {
      return null
    }
  }, [toolInput])
  const output = toolOutput || ''
  const hasArgs = args && Object.keys(args).length > 0
  const hasOutput = output.length > 0
  const entries = hasArgs ? Object.entries(args!) : []

  if (!hasArgs && !hasOutput)
    return (
      <p className="text-xs text-muted-foreground/50 italic">
        {t('toolCallPreview.waitingForResult')}
      </p>
    )

  return (
    <div className="space-y-1">
      {hasArgs && (
        <div>
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="text-xs text-muted-foreground/50 truncate">arguments</span>
            {toolInput && <CopyButton text={JSON.stringify(args, null, 2)} />}
          </div>
          <div className="rounded border border-muted/50 overflow-hidden font-mono text-xs">
            <div className="grid grid-cols-[auto_auto_1fr] gap-x-1 overflow-x-auto max-h-40 overflow-y-auto">
              {entries.map(([key, value]) => (
                <div key={key} className="contents group">
                  <span className="text-muted-foreground/25 select-none px-2 py-0.5 text-right group-hover:bg-muted/30">
                    -
                  </span>
                  <span className="text-muted-foreground/60 select-none py-0.5 group-hover:bg-muted/30">
                    {key}
                  </span>
                  <span className="text-foreground/80 whitespace-pre-wrap break-all px-2 py-0.5 group-hover:bg-muted/30">
                    {typeof value === 'string' ? value : JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {hasOutput && (
        <div>
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="text-xs text-muted-foreground/50 truncate">result</span>
            <CopyButton text={output} />
          </div>
          <pre className="text-xs text-foreground/80 leading-relaxed bg-muted/30 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
            {output}
          </pre>
        </div>
      )}
    </div>
  )
}

// --- Dispatcher ---

export function ToolOutputRenderer({
  toolName,
  toolInput,
  toolOutput,
}: {
  toolName: string
  toolInput?: string
  toolOutput?: string
}) {
  switch (toolName) {
    case 'web_search':
      return <WebSearchOutput toolInput={toolInput} toolOutput={toolOutput} />
    case 'web_fetch':
      return <WebFetchOutput toolInput={toolInput} toolOutput={toolOutput} />
    case 'read':
      return <ReadOutput toolInput={toolInput} toolOutput={toolOutput} />
    case 'skill':
      return <SkillOutput toolInput={toolInput} toolOutput={toolOutput} />
    case 'mcp_schema':
      return <McpSchemaOutput toolInput={toolInput} toolOutput={toolOutput} />
    case 'bash':
      return <BashOutput toolInput={toolInput} toolOutput={toolOutput} />
    case 'kill_shell':
      return <SimpleTextOutput toolOutput={toolOutput} />
    case 'edit':
      return <EditOutput toolInput={toolInput} toolOutput={toolOutput} />
    case 'write':
      return <WriteOutput toolInput={toolInput} toolOutput={toolOutput} />
    case 'grep':
      return <GrepOutput toolOutput={toolOutput} />
    case 'glob':
      return <GlobOutput toolOutput={toolOutput} />
    default:
      return null
  }
}

// --- Helpers ---

function safeParseField(json: string | undefined, field: string): string | null {
  if (!json) return null
  try {
    return JSON.parse(json)[field] ?? null
  } catch {
    return null
  }
}
