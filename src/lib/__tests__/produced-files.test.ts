import { describe, it, expect } from 'vitest'
import { deriveProducedFiles, fileLabel } from '../produced-files'
import type { ToolCall } from '@/types'

function call(
  tool_name: string,
  input: Record<string, unknown>,
  output: string,
  display_order: number,
  status = 'success'
): ToolCall {
  return {
    id: `tc-${display_order}`,
    call_id: null,
    message_id: 'm1',
    tool_name,
    tool_input: JSON.stringify(input),
    tool_output: output,
    status,
    display_order,
    created_at: '2026-11-05T00:00:00Z',
  }
}

describe('deriveProducedFiles', () => {
  it('distinguishes created from modified and keeps first-touch order', () => {
    const files = deriveProducedFiles([
      call('edit', { path: '/p/b.rs' }, 'Edited', 2),
      call('write', { path: '/p/a.rs', content: 'x' }, 'Created /p/a.rs (1 lines, 1 bytes)', 1),
      call('write', { path: '/p/c.rs', content: 'x' }, 'Wrote /p/c.rs (1 lines, 1 bytes)', 3),
      call('edit', { path: '/p/a.rs' }, 'Edited', 4),
    ])
    expect(files).toEqual([
      { path: '/p/a.rs', role: 'created' },
      { path: '/p/b.rs', role: 'modified' },
      { path: '/p/c.rs', role: 'modified' },
    ])
  })

  it('ignores failed calls, other tools, and malformed input', () => {
    const broken = { ...call('write', {}, 'Created x', 3), tool_input: 'not json' }
    expect(
      deriveProducedFiles([
        call('write', { path: '/p/a.rs' }, 'error', 1, 'error'),
        call('bash', { command: 'touch /p/z' }, '', 2),
        broken,
      ])
    ).toEqual([])
  })

  it('labels a path by its last component', () => {
    expect(fileLabel('/p/src/main.rs')).toBe('main.rs')
    expect(fileLabel('C:\\work\\notes.md')).toBe('notes.md')
  })
})
