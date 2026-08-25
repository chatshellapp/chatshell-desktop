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

describe('ToolCallPreview bash rendering', () => {
  it('renders ANSI-colored output as styled spans', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'bash',
          tool_input: JSON.stringify({ command: 'ls' }),
          tool_output: '\u001b[31merror\u001b[0m plain \u001b[1;32mok\u001b[0m',
        })}
      />
    )
    expand(/bash/)

    const body = screen.getByTestId('bash-output')
    // ansi-to-react turns escapes into styled spans; raw escapes must not leak
    expect(body.textContent).not.toContain('\u001b')
    expect(body.textContent).toContain('error')
    expect(body.textContent).toContain('plain')
    expect(body.textContent).toContain('ok')
    const styled = body.querySelectorAll('span[style]')
    expect(styled.length).toBeGreaterThanOrEqual(2)
  })

  it('strips the exit-code marker and shows it as a red chip when nonzero', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'bash',
          tool_input: JSON.stringify({ command: 'false' }),
          tool_output: '[exit code: 1]\nnothing done',
        })}
      />
    )
    expand(/bash/)

    expect(screen.getByText(/exit 1/)).toBeInTheDocument()
    const body = screen.getByTestId('bash-output')
    expect(body.textContent).not.toContain('[exit code: 1]')
    expect(body.textContent).toContain('nothing done')
  })

  it('shows the command line with a $ prompt', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'bash',
          tool_input: JSON.stringify({ command: 'cargo test' }),
          tool_output: '[exit code: 0]\nok. 3 passed',
        })}
      />
    )
    expand(/bash/)

    expect(screen.getByText(/\$ cargo test/)).toBeInTheDocument()
    // exit 0 is not an error chip
    expect(screen.queryByText(/exit 0/)).toBeNull()
  })
})

describe('ToolCallPreview grep rendering', () => {
  it('shows match count and file count in the caption', () => {
    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'grep',
          tool_input: JSON.stringify({ pattern: 'TODO' }),
          tool_output: [
            'src/a.ts:1:TODO first',
            'src/b.ts:5:TODO second',
            'src/c.ts:9:TODO third',
            'src/d.ts:2:TODO fourth',
          ].join('\n'),
        })}
      />
    )
    expand(/grep/)

    expect(screen.getByText(/4 matches/)).toBeInTheDocument()
    expect(screen.getByText(/4 files/)).toBeInTheDocument()
  })

  it('counts matches in count mode and lists files in files mode', () => {
    const { unmount } = render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'grep',
          tool_input: JSON.stringify({ pattern: 'x', output_mode: 'count' }),
          tool_output: 'src/a.ts:3\nsrc/b.rs:2',
        })}
      />
    )
    expand(/grep/)
    expect(screen.getByText(/5 matches/)).toBeInTheDocument()
    unmount()

    render(
      <ToolCallPreview
        toolCall={makeToolCall({
          tool_name: 'grep',
          tool_input: JSON.stringify({ pattern: 'x', output_mode: 'files_with_matches' }),
          tool_output: 'src/a.ts\nsrc/b.rs',
        })}
      />
    )
    expand(/grep/)
    expect(screen.getByText(/2 files/)).toBeInTheDocument()
  })
})
