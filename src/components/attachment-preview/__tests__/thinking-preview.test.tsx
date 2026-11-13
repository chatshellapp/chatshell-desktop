import { describe, it, expect, vi } from 'vitest'
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

  it('renders streamed content while expanded', () => {
    render(<ThinkingPreview content={CONTENT} isStreaming />)

    expect(screen.getByTestId('markdown-content')).toHaveTextContent(CONTENT)
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

  describe('streaming auto-scroll', () => {
    // jsdom has no layout: give the scroller a fixed geometry
    function mockGeometry(el: HTMLElement, scrollHeight: number, clientHeight = 100) {
      Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight })
      Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
    }

    function setup() {
      const { container, rerender } = render(<ThinkingPreview content="a" isStreaming />)
      const scroller = container.querySelector('.max-h-80') as HTMLElement
      return { scroller, rerender }
    }

    it('follows the end of the content as it streams', () => {
      const { scroller, rerender } = setup()
      mockGeometry(scroller, 500)

      rerender(<ThinkingPreview content="ab" isStreaming />)

      expect(scroller.scrollTop).toBe(500)
    })

    it('never scrolls ancestors via scrollIntoView', () => {
      const scrollIntoView = vi.fn()
      window.HTMLElement.prototype.scrollIntoView = scrollIntoView as unknown as () => void
      try {
        const { scroller, rerender } = setup()
        mockGeometry(scroller, 500)
        rerender(<ThinkingPreview content="ab" isStreaming />)
        expect(scrollIntoView).not.toHaveBeenCalled()
      } finally {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
      }
    })

    it('stops following on an upward wheel and leaves the position alone', () => {
      const { scroller, rerender } = setup()
      mockGeometry(scroller, 500)
      rerender(<ThinkingPreview content="ab" isStreaming />)

      fireEvent.wheel(scroller, { deltaY: -10 })
      scroller.scrollTop = 200
      fireEvent.scroll(scroller)
      mockGeometry(scroller, 800)
      rerender(<ThinkingPreview content="abc" isStreaming />)

      expect(scroller.scrollTop).toBe(200)
    })

    it('stops following when scrolled upward without a wheel (scrollbar drag)', () => {
      const { scroller, rerender } = setup()
      mockGeometry(scroller, 500)
      rerender(<ThinkingPreview content="ab" isStreaming />)

      scroller.scrollTop = 150
      fireEvent.scroll(scroller)
      mockGeometry(scroller, 800)
      rerender(<ThinkingPreview content="abc" isStreaming />)

      expect(scroller.scrollTop).toBe(150)
    })

    it('stops following on an upward scroll key', () => {
      const { scroller, rerender } = setup()
      mockGeometry(scroller, 500)
      rerender(<ThinkingPreview content="ab" isStreaming />)

      fireEvent.keyDown(scroller, { key: 'PageUp' })
      scroller.scrollTop = 300
      mockGeometry(scroller, 800)
      rerender(<ThinkingPreview content="abc" isStreaming />)

      expect(scroller.scrollTop).toBe(300)
    })

    it('resumes following once the reader returns to the end', () => {
      const { scroller, rerender } = setup()
      mockGeometry(scroller, 500)
      rerender(<ThinkingPreview content="ab" isStreaming />)

      fireEvent.wheel(scroller, { deltaY: -10 })
      scroller.scrollTop = 200
      fireEvent.scroll(scroller)
      scroller.scrollTop = 400
      fireEvent.scroll(scroller)
      mockGeometry(scroller, 800)
      rerender(<ThinkingPreview content="abc" isStreaming />)

      expect(scroller.scrollTop).toBe(800)
    })
  })
})
