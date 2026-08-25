import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolCallPreview } from '../tool-call-preview'
import type { ToolCall } from '@/types'

function makeToolCall(overrides: Partial<ToolCall> & { tool_name: string }): ToolCall {
  return {
    id: 'tc-1',
    message_id: 'm-1',
    call_id: null,
    tool_input: '{}',
    status: 'success',
    display_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function expand() {
  const header = screen.getByRole('button', { name: /edit|write/ })
  fireEvent.click(header)
}

describe('ToolCallPreview edit/write diff wiring', () => {
  it('renders an edit tool call as a unified diff after expansion', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'edit',
          tool_input: JSON.stringify({
            path: '/src/app.ts',
            old_string: 'const greeting = "hello"',
            new_string: 'const greeting = "hi"',
          }),
          tool_output: 'Successfully replaced 1 occurrence(s) in /src/app.ts\n[anchor re-ground]',
        })}
      />
    )
    expand()

    expect(document.querySelector('[data-diff-row="remove"]')?.textContent).toContain(
      'const greeting = "hello"'
    )
    expect(document.querySelector('[data-diff-row="add"]')?.textContent).toContain(
      'const greeting = "hi"'
    )
    // Backend success line shown as caption
    expect(screen.getByText(/Successfully replaced 1 occurrence/)).toBeInTheDocument()
  })

  it('renders a write tool call as an all-additions diff', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'write',
          tool_input: JSON.stringify({
            path: '/src/new-file.ts',
            content: 'export function foo() {\n  return 1\n}\n',
          }),
          tool_output: 'Created /src/new-file.ts (3 lines, 38 bytes)',
        })}
      />
    )
    expand()

    const addRows = document.querySelectorAll('[data-diff-row="add"]')
    expect(addRows).toHaveLength(3)
    expect(document.querySelector('[data-diff-row="remove"]')).toBeNull()
    expect(screen.getByText(/Created \/src\/new-file\.ts/)).toBeInTheDocument()
  })

  it('still renders the attempted diff when the edit failed', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'edit',
          tool_input: JSON.stringify({
            path: '/src/app.ts',
            old_string: 'missing',
            new_string: 'replacement',
          }),
          status: 'error',
          error: 'old_string was not found in the file',
        })}
      />
    )
    expand()

    expect(document.querySelector('[data-diff-row="remove"]')?.textContent).toContain('missing')
    expect(document.querySelector('[data-diff-row="add"]')?.textContent).toContain('replacement')
    expect(screen.getByText(/old_string was not found/)).toBeInTheDocument()
  })
})

describe('ToolCallPreview collapsed header stats', () => {
  it('shows a +N/-M badge for a completed edit without expanding', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'edit',
          tool_input: JSON.stringify({
            path: '/src/app.ts',
            old_string: 'a\nb\nc',
            new_string: 'a\nX\nc',
          }),
          tool_output: 'Successfully replaced 1 occurrence(s) in /src/app.ts',
        })}
      />
    )

    const badge = screen.getByTestId('diff-stats')
    expect(badge.textContent).toMatch(/\+1/)
    expect(badge.textContent).toMatch(/-1/)
    // Collapsed: no diff rows rendered yet
    expect(document.querySelector('[data-diff-row]')).toBeNull()
  })

  it('shows an all-green badge for write and the filename for read', () => {
    const { unmount } = render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'write',
          tool_input: JSON.stringify({ path: '/src/new.ts', content: 'one\ntwo\nthree' }),
          tool_output: 'Created /src/new.ts (3 lines, 14 bytes)',
        })}
      />
    )
    expect(screen.getByTestId('diff-stats').textContent).toMatch(/\+3/)
    expect(screen.getByTestId('diff-stats').querySelectorAll('.bg-green-500\\/70')).toHaveLength(5)
    unmount()

    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'read',
          tool_input: JSON.stringify({ path: '/src/big.ts' }),
          tool_output: '     1\ta\n     2\tb\n',
        })}
      />
    )
    expect(screen.getByText('big.ts')).toBeInTheDocument()
  })
})

describe('ToolCallPreview humanized errors', () => {
  it('shows the short message with raw error behind a details disclosure', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'edit',
          tool_input: JSON.stringify({
            path: '/src/app.ts',
            old_string: 'a',
            new_string: 'a',
          }),
          status: 'error',
          error: 'Edit error: old_string and new_string are identical; nothing to change',
        })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /edit/ }))

    const block = screen.getByTestId('tool-error')
    expect(block.textContent).toContain('No-op edit: old and new text are identical')
    expect(block.querySelector('details')).toBeInTheDocument()
    // Raw error preserved inside the disclosure
    expect(block.textContent).toContain(
      'old_string and new_string are identical; nothing to change'
    )
  })

  it('shows unknown errors as-is without a disclosure', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'edit',
          tool_input: JSON.stringify({ path: '/x', old_string: 'a', new_string: 'b' }),
          status: 'error',
          error: 'totally unexpected failure',
        })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /edit/ }))

    const block = screen.getByTestId('tool-error')
    expect(block.textContent).toContain('totally unexpected failure')
    expect(block.querySelector('details')).toBeNull()
  })
})
