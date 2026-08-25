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

function expand(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('ToolCallPreview read rendering', () => {
  it('renders tab-prefixed output with real file line numbers in a gutter', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'read',
          tool_input: JSON.stringify({ path: '/src/main.rs', offset: 40 }),
          // Backend format: right-aligned number + TAB
          tool_output: '    40\tfn main() {\n    41\t    println!("hi");\n    42\t}\n',
        })}
      />
    )
    expand(/read/)

    const gutter = screen.getByTestId('read-gutter')
    // Real line numbers shown, not restarted from 1
    expect(gutter.textContent).toContain('40')
    expect(gutter.textContent).toContain('42')
    // Tab prefixes must not leak into the content
    expect(gutter.textContent).not.toContain('\tfn')
    expect(gutter.textContent).toContain('println!("hi")')
    // Caption carries path + line count + size
    expect(screen.getByText(/\/src\/main\.rs/)).toBeInTheDocument()
  })

  it('shows the backend truncation footer as a note row', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'read',
          tool_input: JSON.stringify({ path: '/src/big.ts' }),
          tool_output: '     9\tlast shown\n\n... (91 more lines, 100 total)',
        })}
      />
    )
    expand(/read/)

    expect(screen.getByText(/\.\.\. \(91 more lines, 100 total\)/)).toBeInTheDocument()
  })

  it('renders a gap row for non-contiguous line numbers', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'read',
          tool_input: JSON.stringify({ path: '/src/gap.ts' }),
          tool_output: '     5\tfive\n     9\tnine\n',
        })}
      />
    )
    expand(/read/)

    expect(screen.getAllByTestId('read-gap')).toHaveLength(1)
  })

  it('falls back to a plain code block for unprefixed output', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'read',
          tool_input: JSON.stringify({ path: '/src/icon.svg' }),
          tool_output: '[Image: SVG, 1.2 KB]\n\n<svg></svg>',
        })}
      />
    )
    expand(/read/)

    expect(screen.queryByTestId('read-gutter')).toBeNull()
    expect(screen.getByText(/\[Image: SVG/)).toBeTruthy()
  })
})
