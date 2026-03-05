import { useState } from 'react'
import { ExternalLink, Copy, Check } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { MarkdownContent } from '@/components/markdown-content'
import { getDomain } from './utils'

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
  const { copied, handleCopy } = useCopyButton(text)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        handleCopy()
      }}
      className="p-1 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  rs: 'rust',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  zig: 'zig',
  vue: 'vue',
  svelte: 'svelte',
}

function getLangFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return EXT_LANG_MAP[ext] || ''
}

// --- Input summary extraction ---

function extractCommandNames(command: string): string {
  // Strip heredoc/stdin content: remove everything from << (with optional quotes) to EOF
  const stripped = command.replace(/<<-?\s*'?\w+'?[\s\S]*/, '')

  const names = stripped
    .split(/\s*(?:&&|\|\||[|;])\s*/)
    .map((segment) => {
      const trimmed = segment.trim()
      if (!trimmed) return null
      const parts = trimmed.split(/\s+/)
      for (const part of parts) {
        if (part.includes('=') || part === 'sudo' || part === 'env') continue
        // Handle redirects like > or >>
        if (part === '>' || part === '>>' || part === '<' || part === '2>') return null
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
      case 'edit':
      case 'write':
        return parsed.path ? fileNameFromPath(parsed.path) : null
      case 'load_skill':
        return parsed.name ?? null
      case 'load_mcp_schema':
        return parsed.tool_name ?? null
      case 'bash':
        return parsed.command ? extractCommandNames(parsed.command) : null
      case 'web_search':
        return parsed.query || null
      case 'web_fetch':
        return parsed.url ? getDomain(parsed.url) : null
      case 'glob':
        return parsed.pattern || null
      case 'grep':
        return parsed.pattern || null
      default:
        return null
    }
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
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground/60 truncate">"{query}"</span>
          {output && <CopyButton text={output} />}
        </div>
      )}
      {output && (
        <div className="max-h-60 overflow-y-auto rounded bg-muted/30 p-2">
          <MarkdownContent content={output} className="text-xs" />
        </div>
      )}
    </div>
  )
}

export function WebFetchOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const url = safeParseField(toolInput, 'url')
  const domain = url ? getDomain(url) : null
  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : null

  return (
    <div className="space-y-2">
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
          <span className="text-xs text-muted-foreground/70 font-mono truncate flex-1 min-w-0">
            {url}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              openUrl(url)
            }}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0"
            title="Open in browser"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
          {toolOutput && <CopyButton text={toolOutput} />}
        </div>
      )}
      {toolOutput && (
        <div className="max-h-60 overflow-y-auto rounded bg-muted/30 p-2">
          <MarkdownContent content={toolOutput} className="text-xs" />
        </div>
      )}
    </div>
  )
}

export function ReadOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const path = safeParseField(toolInput, 'path') || ''
  const lang = getLangFromPath(path)
  const output = toolOutput || ''

  // Strip line-number prefixes (e.g. "    12|content") for cleaner display
  const lines = output.split('\n')
  const hasLineNumbers = lines.length > 1 && /^\s*\d+\|/.test(lines[0])

  let displayContent: string
  if (hasLineNumbers) {
    displayContent =
      '```' + lang + '\n' + lines.map((l) => l.replace(/^\s*\d+\|/, '')).join('\n') + '\n```'
  } else {
    displayContent = '```' + lang + '\n' + output + '\n```'
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground/60 font-mono truncate">{path}</span>
        {output && <CopyButton text={output} />}
      </div>
      <div className="max-h-60 overflow-y-auto rounded">
        <MarkdownContent content={displayContent} className="text-xs" />
      </div>
    </div>
  )
}

export function BashOutput({ toolInput, toolOutput }: ToolOutputProps) {
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
          <span className="text-xs text-red-400/80 flex-shrink-0 mr-auto">exit {exitCode}</span>
        )}
        {cleanOutput && <CopyButton text={cleanOutput} />}
      </div>
      <div className="rounded bg-zinc-900 dark:bg-zinc-950 max-h-60 overflow-y-auto p-2.5">
        {command && (
          <div className="text-xs font-mono text-green-400/80 mb-1.5 break-all">$ {command}</div>
        )}
        {cleanOutput && (
          <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap break-all leading-relaxed">
            {cleanOutput}
          </pre>
        )}
      </div>
    </div>
  )
}

export function EditWriteOutput({ toolOutput }: ToolOutputProps) {
  if (!toolOutput) return null
  return <p className="text-xs text-muted-foreground/70 leading-relaxed">{toolOutput}</p>
}

export function GrepOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const pattern = safeParseField(toolInput, 'pattern') || ''
  const output = toolOutput || ''

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        {pattern && (
          <span className="text-xs text-muted-foreground/60 font-mono truncate">/{pattern}/</span>
        )}
        {output && <CopyButton text={output} />}
      </div>
      <pre className="text-xs text-foreground/70 leading-relaxed bg-muted/30 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto font-mono">
        {output}
      </pre>
    </div>
  )
}

export function GlobOutput({ toolOutput }: ToolOutputProps) {
  const output = toolOutput || ''
  const files = output.split('\n').filter(Boolean)
  const fileCount = files.length

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground/60">
          {fileCount} {fileCount === 1 ? 'file' : 'files'}
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

export function LoadSkillOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const name = safeParseField(toolInput, 'name') || ''
  const output = toolOutput || ''
  const normalized = output ? normalizeSkillMarkdown(output) : ''

  return (
    <div className="space-y-2">
      {name && (
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="text-xs text-muted-foreground/70 font-medium truncate min-w-0">
            {name}
          </span>
          {output && <CopyButton text={output} />}
        </div>
      )}
      {normalized && (
        <div className="max-h-60 overflow-y-auto rounded bg-muted/30 p-2">
          <MarkdownContent content={normalized} className="text-xs" />
        </div>
      )}
    </div>
  )
}

function tryFormatJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

export function LoadMcpSchemaOutput({ toolInput, toolOutput }: ToolOutputProps) {
  const toolName = safeParseField(toolInput, 'tool_name') || ''
  const output = toolOutput || ''
  const formatted = tryFormatJson(output)
  const codeBlock = formatted ? '```json\n' + formatted + '\n```' : ''

  return (
    <div className="space-y-2">
      {toolName && (
        <div className="flex items-center justify-between min-w-0">
          <span className="text-xs text-muted-foreground/70 font-mono truncate">
            {toolName}
          </span>
          {output && <CopyButton text={output} />}
        </div>
      )}
      {codeBlock && (
        <div className="max-h-60 overflow-y-auto rounded bg-muted/30 p-2">
          <MarkdownContent content={codeBlock} className="text-xs [&_pre]:!bg-transparent [&_pre]:!p-0" />
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
    case 'load_skill':
      return <LoadSkillOutput toolInput={toolInput} toolOutput={toolOutput} />
    case 'load_mcp_schema':
      return <LoadMcpSchemaOutput toolInput={toolInput} toolOutput={toolOutput} />
    case 'bash':
      return <BashOutput toolInput={toolInput} toolOutput={toolOutput} />
    case 'edit':
    case 'write':
      return <EditWriteOutput toolOutput={toolOutput} />
    case 'grep':
      return <GrepOutput toolInput={toolInput} toolOutput={toolOutput} />
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
