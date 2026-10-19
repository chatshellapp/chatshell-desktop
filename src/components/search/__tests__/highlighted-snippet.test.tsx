import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HighlightedSnippet } from '../highlighted-snippet'

function marks(container: HTMLElement) {
  return Array.from(container.querySelectorAll('mark'))
}

describe('HighlightedSnippet', () => {
  it('renders plain text without mark elements', () => {
    const { container } = render(<HighlightedSnippet text="plain text" />)
    expect(marks(container)).toHaveLength(0)
    expect(screen.getByText('plain text').tagName).toBe('SPAN')
  })

  it('wraps the marked fragment in a mark element', () => {
    const { container } = render(<HighlightedSnippet text="Hello <mark>wor</mark>ld" />)
    expect(screen.getByText('wor').tagName).toBe('MARK')
    expect(marks(container)).toHaveLength(1)
    expect(container.firstChild).toHaveTextContent('Hello world')
  })

  it('highlights multiple fragments independently', () => {
    const { container } = render(<HighlightedSnippet text="a<mark>b</mark>c<mark>d</mark>e" />)
    expect(marks(container).map((m) => m.textContent)).toEqual(['b', 'd'])
    expect(container.firstChild).toHaveTextContent('abcde')
  })

  it('handles fragments at both ends of the snippet', () => {
    const { container } = render(
      <HighlightedSnippet text="<mark>start</mark> middle <mark>end</mark>" />
    )
    expect(marks(container).map((m) => m.textContent)).toEqual(['start', 'end'])
    expect(container.firstChild).toHaveTextContent('start middle end')
  })

  it('renders an empty string without crashing', () => {
    const { container } = render(<HighlightedSnippet text="" />)
    expect(marks(container)).toHaveLength(0)
    expect(container.firstChild).toHaveTextContent('')
  })
})
