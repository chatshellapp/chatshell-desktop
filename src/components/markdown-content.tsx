import { useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeRaw from "rehype-raw"
import "katex/dist/katex.min.css"

interface MarkdownContentProps {
  content: string
  className?: string
  /** Use smaller text sizes, suitable for previews */
  compact?: boolean
}

export function MarkdownContent({ content, className = "", compact = false }: MarkdownContentProps) {
  const markdownComponents = useMemo(() => ({
    code(props: any) {
      const { className, children, ...rest } = props
      const languageMatch = /language-([\w-+]+)/.exec(className || '')
      const codeContent = String(children).replace(/\n$/, '')
      const isMultiline = codeContent.includes('\n')
      const isCodeBlock = languageMatch || isMultiline

      if (isCodeBlock) {
        return (
          <code
            className={`${className || ''} block p-3 rounded-md bg-muted overflow-x-auto text-sm`}
            {...rest}
          >
            {children}
          </code>
        )
      }

      return (
        <code
          className="px-1.5 py-0.5 rounded-md bg-muted text-sm font-mono"
          {...rest}
        >
          {children}
        </code>
      )
    },

    pre({ children }: any) {
      return <pre className="my-2 overflow-visible">{children}</pre>
    },

    p({ children }: any) {
      return <p className="mb-2 last:mb-0">{children}</p>
    },

    ul({ children }: any) {
      return <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>
    },
    ol({ children }: any) {
      return <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>
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
      return <h1 className={compact ? "text-xl font-bold mb-2 mt-3" : "text-2xl font-bold mb-2 mt-4"}>{children}</h1>
    },
    h2({ children }: any) {
      return <h2 className={compact ? "text-lg font-bold mb-2 mt-2" : "text-xl font-bold mb-2 mt-3"}>{children}</h2>
    },
    h3({ children }: any) {
      return <h3 className={compact ? "text-base font-bold mb-2 mt-2" : "text-lg font-bold mb-2 mt-2"}>{children}</h3>
    },
    h4({ children }: any) {
      return <h4 className={compact ? "text-sm font-bold mb-2 mt-2" : "text-base font-bold mb-2 mt-2"}>{children}</h4>
    },
    h5({ children }: any) {
      return <h5 className="text-sm font-bold mb-1 mt-2">{children}</h5>
    },
    h6({ children }: any) {
      return <h6 className={compact ? "text-xs font-semibold mb-1 mt-2" : "text-sm font-semibold mb-1 mt-2"}>{children}</h6>
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
          <table className="min-w-full border-collapse border border-border">
            {children}
          </table>
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
      return <th className="border border-border px-3 py-1 text-left text-sm font-semibold">{children}</th>
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
  }), [compact])

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

