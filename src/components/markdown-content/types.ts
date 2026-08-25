export interface MarkdownContentProps {
  content: string
  className?: string
  /** Use smaller text sizes, suitable for previews */
  compact?: boolean
  /** Uniform font size — all content at the same scale regardless of element type */
  flat?: boolean
}

export interface CodeBlockProps {
  language: string
  code: string
  flat?: boolean
}

export interface MermaidBlockProps {
  code: string
  flat?: boolean
}
