export interface MarkdownContentProps {
  content: string
  className?: string
  /** Use smaller text sizes, suitable for previews */
  compact?: boolean
}

export interface CodeBlockProps {
  language: string
  code: string
}

export interface MermaidBlockProps {
  code: string
}

