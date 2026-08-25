import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiffView, DiffStatsBadge } from '../diff-view'

describe('DiffView', () => {
  it('renders add and remove rows with line-number gutters', () => {
    render(<DiffView oldText={'const a = 1\n'} newText={'const a = 2\n'} />)
    const addRow = document.querySelector('[data-diff-row="add"]')
    const removeRow = document.querySelector('[data-diff-row="remove"]')

    expect(removeRow?.textContent).toContain('const a = 1')
    expect(addRow?.textContent).toContain('const a = 2')
    expect(removeRow?.textContent).toContain('-')
    // Remove row carries the old line number, add row the new one
    expect(removeRow?.textContent).toMatch(/^1-const a = 1/)
    expect(addRow?.textContent).toMatch(/^1\+const a = 2/)
  })

  it('renders a hunk header row', () => {
    render(<DiffView oldText={'a\nb\nc\nd\ne\nf\ng\n'} newText={'a\nb\nC\nd\ne\nf\nG\n'} />)
    expect(screen.getAllByText(/@@ -1,7 \+1,7 @@/).length).toBeGreaterThan(0)
  })

  it('renders word-level highlight spans on changed lines', () => {
    render(<DiffView oldText={'const x = 1\n'} newText={'const x = 2\n'} />)
    const highlighted = document.querySelectorAll('.bg-red-500\\/30, .bg-green-500\\/30')
    expect(highlighted.length).toBeGreaterThanOrEqual(2)
    expect([...highlighted].map((el) => el.textContent)).toContain('1')
    expect([...highlighted].map((el) => el.textContent)).toContain('2')
  })

  it('renders nothing for identical texts', () => {
    const { container } = render(<DiffView oldText={'same\n'} newText={'same\n'} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a truncation footer when rows exceed maxRows', () => {
    const old = Array.from({ length: 30 }, (_, i) => `old-${i}`).join('\n') + '\n'
    const next = Array.from({ length: 30 }, (_, i) => `new-${i}`).join('\n') + '\n'
    render(<DiffView oldText={old} newText={next} maxRows={5} />)
    const footer = screen.getByTestId('diff-more-lines')
    expect(footer).toBeInTheDocument()
    expect(footer.textContent).toMatch(/more lines|moreLines/)
  })

  it('treats empty old text as an all-additions diff', () => {
    render(<DiffView oldText={''} newText={'hello\nworld\n'} />)
    const addRows = document.querySelectorAll('[data-diff-row="add"]')
    expect(addRows).toHaveLength(2)
    expect(document.querySelector('[data-diff-row="remove"]')).toBeNull()
  })
})

describe('DiffStatsBadge', () => {
  it('renders +N, proportional blocks, and -M', () => {
    render(<DiffStatsBadge additions={3} deletions={1} />)
    const badge = screen.getByTestId('diff-stats')
    expect(badge.textContent).toContain('+3')
    expect(badge.textContent).toContain('-1')
    // 5 blocks: 3-4 green, rest red, none empty-only
    const blocks = badge.querySelectorAll('.h-2')
    expect(blocks).toHaveLength(5)
    expect(badge.querySelectorAll('.bg-green-500\\/70').length).toBeGreaterThanOrEqual(3)
  })

  it('renders only green blocks for pure additions', () => {
    render(<DiffStatsBadge additions={10} deletions={0} />)
    const badge = screen.getByTestId('diff-stats')
    expect(badge.querySelectorAll('.bg-green-500\\/70')).toHaveLength(5)
    expect(badge.querySelectorAll('.bg-red-500\\/70')).toHaveLength(0)
  })

  it('renders nothing when there are no changes', () => {
    const { container } = render(<DiffStatsBadge additions={0} deletions={0} />)
    expect(container).toBeEmptyDOMElement()
  })
})
