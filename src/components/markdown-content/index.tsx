import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import 'katex/dist/katex.min.css'

import { useMarkdownComponents } from './markdown-components'
import { escapeNonMathDollars } from './math-dollars'
import { markdownSanitizeSchema } from './sanitize-schema'
import type { MarkdownContentProps } from './types'
import type { Components } from 'react-markdown'

// Memoized on content + render options (all primitives; the components map
// from useMarkdownComponents is referentially stable for the same inputs):
// historical messages have immutable content, so parent re-renders no longer
// re-parse their markdown.
export const MarkdownContent = memo(function MarkdownContent({
  content,
  className = '',
  compact = false,
  flat = false,
}: MarkdownContentProps) {
  const markdownComponents = useMarkdownComponents({ compact, flat }) as unknown as Components

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // Sanitize right after raw HTML becomes elements, and before KaTeX
        // renders math, so only Markdown/HTML from the message is filtered.
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], rehypeKatex]}
        components={markdownComponents}
      >
        {escapeNonMathDollars(content)}
      </ReactMarkdown>
    </div>
  )
})

// Re-export components and types
export { CodeBlock } from './code-block'
export { MermaidBlock } from './mermaid-block'
export { SvgFigureBlock } from './svg-figure-block'
export { MarkdownStreamingContext, useMarkdownStreaming } from './streaming-context'
export { useMarkdownComponents } from './markdown-components'
export type {
  MarkdownContentProps,
  CodeBlockProps,
  MermaidBlockProps,
  SvgFigureBlockProps,
} from './types'
