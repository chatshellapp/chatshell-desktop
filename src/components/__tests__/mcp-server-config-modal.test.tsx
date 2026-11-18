import { describe, expect, it } from 'vitest'
import { parseTimeoutSecs } from '../mcp-server-config-modal'

describe('parseTimeoutSecs', () => {
  it('leaves an empty field to the default', () => {
    expect(parseTimeoutSecs('')).toBeUndefined()
    expect(parseTimeoutSecs('   ')).toBeUndefined()
  })

  it('accepts whole non-negative seconds, including 0 (no deadline)', () => {
    expect(parseTimeoutSecs('45')).toBe(45)
    expect(parseTimeoutSecs(' 0 ')).toBe(0)
  })

  it('rejects fractions, negatives, and text', () => {
    expect(parseTimeoutSecs('1.5')).toBeUndefined()
    expect(parseTimeoutSecs('-3')).toBeUndefined()
    expect(parseTimeoutSecs('abc')).toBeUndefined()
  })
})
