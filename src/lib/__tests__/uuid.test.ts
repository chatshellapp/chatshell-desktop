import { describe, it, expect, vi, afterEach } from 'vitest'
import { uuidv7 } from '../uuid'

describe('uuidv7', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats a version 7, RFC 9562 variant UUID', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('encodes the current millisecond timestamp in the first 48 bits', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T00:00:00.123Z'))

    const hex = uuidv7().replace(/-/g, '').slice(0, 12)

    expect(parseInt(hex, 16)).toBe(Date.parse('2026-10-31T00:00:00.123Z'))
  })

  it('sorts by creation time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const earlier = uuidv7()
    vi.setSystemTime(2_000)
    const later = uuidv7()

    expect(earlier < later).toBe(true)
  })
})
