export interface MarkdownContentProps {
  content: string
  className?: string
  /** Use smaller text sizes, suitable for previews */
  compact?: boolean
  /** Uniform font size — all content at the same scale regardless of element type */
  flat?: boolean
  /**
   * Render raw HTML as elements (default). When false, HTML is shown as
   * literal text so no part of the content can be hidden by markup.
   */
  rawHtml?: boolean
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

export interface SvgFigureBlockProps {
  code: string
  flat?: boolean
}

export interface OpenUiBlockProps {
  code: string
  flat?: boolean
}
