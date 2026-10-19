import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThinkingPreview } from '../thinking-preview'
import '@/lib/i18n'

vi.mock('@/components/markdown-content', () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="markdown-content">{content}</div>
  ),
}))

const CONTENT = 'Step one, consider the request. Step two, answer.'

describe('ThinkingPreview', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // jsdom does not implement scrollIntoView, used for streaming auto-scroll
    scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView as unknown as () => void
  })

  afterEach(() => {
    delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
  })

  it('renders collapsed by default once thinking finished', () => {
    const { container } = render(<ThinkingPreview content={CONTENT} />)

    expect(screen.getByRole('button', { name: /Thought process/ })).toBeInTheDocument()
    expect(screen.queryByTestId('markdown-content')).toBeNull()
    expect((container.firstChild as HTMLElement).className).toContain('border-transparent')
  })

  it('expands and collapses again when the header is toggled', () => {
    const { container } = render(<ThinkingPreview content={CONTENT} />)

    fireEvent.click(screen.getByRole('button', { name: /Thought process/ }))
    expect(screen.getByTestId('markdown-content')).toHaveTextContent(CONTENT)
    expect((container.firstChild as HTMLElement).className).toContain('w-full')

    fireEvent.click(screen.getByRole('button', { name: /Thought process/ }))
    expect(screen.queryByTestId('markdown-content')).toBeNull()
  })

  it('auto-expands while streaming and shows the processing placeholder when empty', () => {
    render(<ThinkingPreview content="" isStreaming />)

    expect(screen.getByRole('button', { name: /Thinking/ })).toBeInTheDocument()
    expect(screen.getByText('Processing...')).toBeInTheDocument()
    expect(screen.queryByTestId('markdown-content')).toBeNull()
  })

  it('renders streamed content while expanded and auto-scrolls to it', () => {
    render(<ThinkingPreview content={CONTENT} isStreaming />)

    expect(screen.getByTestId('markdown-content')).toHaveTextContent(CONTENT)
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('auto-expands when streaming starts on an already mounted preview', () => {
    const { rerender } = render(<ThinkingPreview content={CONTENT} />)
    expect(screen.queryByTestId('markdown-content')).toBeNull()

    rerender(<ThinkingPreview content={CONTENT} isStreaming />)

    expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Thinking/ })).toBeInTheDocument()
  })

  it('keeps a streaming preview collapsed in a compact bordered style after a manual collapse', () => {
    const { container } = render(<ThinkingPreview content={CONTENT} isStreaming />)

    fireEvent.click(screen.getByRole('button', { name: /Thinking/ }))

    expect(screen.queryByTestId('markdown-content')).toBeNull()
    expect((container.firstChild as HTMLElement).className).toContain('border-muted/40')
    expect((container.firstChild as HTMLElement).className).toContain('w-fit')
  })

  it('stays expanded from the first render when defaultExpanded is set', () => {
    render(<ThinkingPreview content={CONTENT} defaultExpanded />)

    expect(screen.getByTestId('markdown-content')).toHaveTextContent(CONTENT)
    expect(screen.getByRole('button', { name: /Thought process/ })).toBeInTheDocument()
  })

  it('tolerates scroll events inside the expanded content', () => {
    const { container } = render(<ThinkingPreview content={CONTENT} isStreaming />)
    const scroller = container.querySelector('.max-h-80')

    fireEvent.scroll(scroller as HTMLElement)

    expect(scroller).toBeInTheDocument()
  })
})
