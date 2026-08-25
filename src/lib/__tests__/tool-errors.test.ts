import { describe, it, expect } from 'vitest'
import { humanizeToolError } from '@/lib/tool-errors'

describe('humanizeToolError', () => {
  it('maps known backend error substrings to short messages', () => {
    expect(
      humanizeToolError('Edit error: old_string and new_string are identical; nothing to change')
    ).toBe('No-op edit: old and new text are identical')
    expect(
      humanizeToolError(
        'Edit error: The edit would leave the file byte-identical: the matched text already equals new_string.'
      )
    ).toBe('No-op edit: old and new text are identical')
    expect(
      humanizeToolError('Edit error: old_string appears 3 times in /a.ts. Provide more context')
    ).toBe('old_string is not unique; add context or use replace_all')
    expect(
      humanizeToolError(
        'Edit error: Content anchor is stale: the file no longer hashes to tag abc (current def). Re-read.'
      )
    ).toBe('File changed since the last read; re-read and retry')
    expect(humanizeToolError('Read error: File not found: /nope.ts')).toBe('File not found')
    expect(humanizeToolError('Read error: Path is a directory, not a file: /tmp')).toBe(
      'Path is not a file'
    )
    expect(
      humanizeToolError('Write blocked: outside project directory (/etc is not under /repo)')
    ).toBe('Path is outside the project directory')
    expect(humanizeToolError('Command timed out after 30s')).toBe('Command timed out')
  })

  it('passes unknown errors through unchanged', () => {
    expect(humanizeToolError('something exotic broke')).toBe('something exotic broke')
    expect(humanizeToolError('')).toBe('')
  })
})
