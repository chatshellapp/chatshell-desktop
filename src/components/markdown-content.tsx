import { useMemo, useState, useCallback, useEffect, useId } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy, AlertTriangle, Download } from 'lucide-react'
import mermaid from 'mermaid'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import 'katex/dist/katex.min.css'

// Initialize mermaid with default config - runs once on module load
let mermaidInitialized = false

function initializeMermaid() {
  if (mermaidInitialized) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    // Enable all diagram types explicitly
    flowchart: { useMaxWidth: true },
    sequence: { useMaxWidth: true },
    mindmap: { useMaxWidth: true, padding: 10 },
  })
  mermaidInitialized = true
}

interface MarkdownContentProps {
  content: string
  className?: string
  /** Use smaller text sizes, suitable for previews */
  compact?: boolean
}

interface CodeBlockProps {
  language: string
  code: string
}

interface MermaidBlockProps {
  code: string
}

// Clean up any orphaned mermaid error elements from failed renders
function cleanupMermaidElements(elementId: string) {
  // Mermaid creates elements with id like 'd${id}' for the diagram
  const possibleIds = [elementId, `d${elementId}`, `${elementId}-svg`]
  possibleIds.forEach((id) => {
    const element = document.getElementById(id)
    if (element) {
      element.remove()
    }
  })
  // Also clean up any orphaned mermaid error containers
  document.querySelectorAll('[id^="mermaid-"][id$="-svg"]').forEach((el) => {
    if (!el.closest('.mermaid-container')) {
      el.remove()
    }
  })
}

// Debounce delay for mermaid rendering during streaming
const MERMAID_RENDER_DEBOUNCE_MS = 300

function MermaidBlock({ code }: MermaidBlockProps) {
  const uniqueId = useId()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renderKey, setRenderKey] = useState(0)
  const [copied, setCopied] = useState(false)
  const [isWaiting, setIsWaiting] = useState(true) // Start in waiting state

  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout>

    // Show waiting state immediately when code changes
    setIsWaiting(true)

    const renderDiagram = async () => {
      // Generate a valid DOM id from useId (remove colons) with render key for uniqueness
      const elementId = `mermaid-${uniqueId.replace(/:/g, '-')}-${renderKey}-${Date.now()}`

      try {
        // Ensure mermaid is initialized before rendering
        initializeMermaid()

        const { svg: renderedSvg } = await mermaid.render(elementId, code)
        if (!cancelled) {
          setSvg(renderedSvg)
          setError(null)
          setIsWaiting(false)
        }
      } catch (err) {
        // Clean up any leftover DOM elements from failed render
        cleanupMermaidElements(elementId)

        if (!cancelled) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram'
          setError(errorMessage)
          // Don't clear svg - keep showing last successful render if any
          setIsWaiting(false)
        }
      }
    }

    // Debounce rendering to avoid flickering during streaming
    timeoutId = setTimeout(() => {
      if (!cancelled) {
        renderDiagram()
      }
    }, MERMAID_RENDER_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [code, uniqueId, renderKey])

  // Retry handler for error state
  const handleRetry = useCallback(() => {
    setError(null)
    setSvg(null)
    setRenderKey((k) => k + 1)
  }, [])

  // Copy source code to clipboard
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  // Download SVG as file using Tauri dialog
  const handleDownload = useCallback(async () => {
    if (!svg) return
    try {
      const filePath = await save({
        defaultPath: 'mermaid-diagram.svg',
        filters: [{ name: 'SVG Image', extensions: ['svg'] }],
      })
      if (filePath) {
        await writeTextFile(filePath, svg)
      }
    } catch (err) {
      console.error('Failed to save diagram:', err)
    }
  }, [svg])

  // Show error only when not waiting and no successful render exists
  if (error && !isWaiting && !svg) {
    return (
      <div className="my-2 border border-amber-500/50 rounded-md overflow-hidden isolate">
        <div className="flex items-center justify-between px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-xs text-amber-700 font-medium">Mermaid Diagram Error</span>
          </div>
          <button
            onClick={handleRetry}
            className="text-xs text-amber-700 hover:text-amber-900 hover:underline"
          >
            Retry
          </button>
        </div>
        <div className="p-3 bg-amber-50/50">
          <pre className="text-xs text-amber-800 whitespace-pre-wrap font-mono break-words max-h-20 overflow-y-auto">
            {error}
          </pre>
          <details className="mt-2">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              Show source code
            </summary>
            <pre className="mt-2 p-2 bg-muted rounded text-xs font-mono overflow-x-auto max-h-40 overflow-y-auto">
              {code}
            </pre>
          </details>
        </div>
      </div>
    )
  }

  // Show loading state only when waiting and no previous render exists
  if (isWaiting && !svg) {
    return (
      <div className="my-2 border border-border rounded-md p-4 flex items-center justify-center bg-muted/30">
        <span className="text-sm text-muted-foreground">Rendering diagram...</span>
      </div>
    )
  }

  // No SVG and not in any special state - shouldn't normally happen
  if (!svg) {
    return (
      <div className="my-2 border border-border rounded-md p-4 flex items-center justify-center bg-muted/30">
        <span className="text-sm text-muted-foreground">Waiting for diagram code...</span>
      </div>
    )
  }

  return (
    <div className="my-2 border border-border rounded-md overflow-hidden mermaid-container">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">mermaid</span>
          {isWaiting && (
            <span className="text-xs text-muted-foreground/60 italic">updating...</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-black/5 rounded transition-colors"
            aria-label={copied ? 'Copied!' : 'Copy source'}
            title="Copy source code"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-black/5 rounded transition-colors"
            aria-label="Download SVG"
            title="Download as SVG"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download</span>
          </button>
        </div>
      </div>
      <div
        className="p-4 bg-white flex justify-center overflow-x-auto [&>svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <div className="relative group my-2 border border-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border">
        <span className="text-xs text-muted-foreground font-mono">{language || 'text'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-black/5 rounded transition-colors"
          aria-label={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneLight}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '0.875rem',
          background: '#fafafa',
        }}
        showLineNumbers={code.split('\n').length > 3}
        wrapLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

export function MarkdownContent({
  content,
  className = '',
  compact = false,
}: MarkdownContentProps) {
  const markdownComponents = useMemo(
    () => ({
      code(props: any) {
        const { className, children, node, ...rest } = props
        const languageMatch = /language-([\w-+]+)/.exec(className || '')
        const codeContent = String(children).replace(/\n$/, '')
        const isMultiline = codeContent.includes('\n')
        // Check if this is inside a <pre> tag (code block) vs inline code
        const isCodeBlock = node?.position && (languageMatch || isMultiline)

        if (isCodeBlock) {
          const language = languageMatch ? languageMatch[1] : ''

          // Handle mermaid diagrams
          if (language === 'mermaid') {
            return <MermaidBlock code={codeContent} />
          }

          return <CodeBlock language={language} code={codeContent} />
        }

        return (
          <code className="px-1.5 py-0.5 rounded-md bg-muted text-sm font-mono" {...rest}>
            {children}
          </code>
        )
      },

      pre({ children }: any) {
        // Just return children directly since CodeBlock handles its own wrapper
        return <>{children}</>
      },

      p({ children }: any) {
        return <p className="mb-2 last:mb-0">{children}</p>
      },

      ul({ children }: any) {
        return <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>
      },
      ol({ children, start }: any) {
        return (
          <ol className="list-decimal pl-5 mb-2 space-y-1" start={start}>
            {children}
          </ol>
        )
      },
      li({ children }: any) {
        return <li className="pl-1">{children}</li>
      },

      blockquote({ children }: any) {
        return (
          <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic my-2">
            {children}
          </blockquote>
        )
      },

      h1({ children }: any) {
        return (
          <h1 className={compact ? 'text-xl font-bold mb-2 mt-3' : 'text-2xl font-bold mb-2 mt-4'}>
            {children}
          </h1>
        )
      },
      h2({ children }: any) {
        return (
          <h2 className={compact ? 'text-lg font-bold mb-2 mt-2' : 'text-xl font-bold mb-2 mt-3'}>
            {children}
          </h2>
        )
      },
      h3({ children }: any) {
        return (
          <h3 className={compact ? 'text-base font-bold mb-2 mt-2' : 'text-lg font-bold mb-2 mt-2'}>
            {children}
          </h3>
        )
      },
      h4({ children }: any) {
        return (
          <h4 className={compact ? 'text-sm font-bold mb-2 mt-2' : 'text-base font-bold mb-2 mt-2'}>
            {children}
          </h4>
        )
      },
      h5({ children }: any) {
        return <h5 className="text-sm font-bold mb-1 mt-2">{children}</h5>
      },
      h6({ children }: any) {
        return (
          <h6
            className={
              compact ? 'text-xs font-semibold mb-1 mt-2' : 'text-sm font-semibold mb-1 mt-2'
            }
          >
            {children}
          </h6>
        )
      },

      a({ href, children }: any) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            {children}
          </a>
        )
      },

      img({ src, alt }: any) {
        return (
          <img
            src={src}
            alt={alt || ''}
            className="max-w-full h-auto rounded-md my-2"
            loading="lazy"
          />
        )
      },

      table({ children }: any) {
        return (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full border-collapse border border-border">{children}</table>
          </div>
        )
      },
      thead({ children }: any) {
        return <thead className="bg-muted">{children}</thead>
      },
      tbody({ children }: any) {
        return <tbody>{children}</tbody>
      },
      tr({ children }: any) {
        return <tr className="border-b border-border">{children}</tr>
      },
      th({ children }: any) {
        return (
          <th className="border border-border px-3 py-1 text-left text-sm font-semibold">
            {children}
          </th>
        )
      },
      td({ children }: any) {
        return <td className="border border-border px-3 py-1 text-sm">{children}</td>
      },

      hr() {
        return <hr className="my-4 border-border" />
      },

      // Task list checkbox (GFM feature)
      input({ type, checked, disabled }: any) {
        if (type === 'checkbox') {
          return (
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              className="mr-2 h-4 w-4 rounded border-border"
              readOnly
            />
          )
        }
        return <input type={type} />
      },

      // Strikethrough (GFM feature)
      del({ children }: any) {
        return <del className="text-muted-foreground line-through">{children}</del>
      },
    }),
    [compact]
  )

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
