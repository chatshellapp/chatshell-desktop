import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import 'katex/dist/katex.min.css'

import { useMarkdownComponents } from './markdown-components'
import type { MarkdownContentProps } from './types'

export function MarkdownContent({
  content,
  className = '',
  compact = false,
}: MarkdownContentProps) {
  const markdownComponents = useMarkdownComponents({ compact })

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

// Re-export components and types
export { CodeBlock } from './code-block'
export { MermaidBlock } from './mermaid-block'
export { useMarkdownComponents } from './markdown-components'
export type { MarkdownContentProps, CodeBlockProps, MermaidBlockProps } from './types'

