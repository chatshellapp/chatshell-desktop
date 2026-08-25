import { describe, it, expect } from 'vitest'
import { computeUnifiedDiff, diffStatCounts, DIFF_MAX_ROWS } from '@/lib/tool-diff'

describe('computeUnifiedDiff', () => {
  it('produces no rows for identical texts', () => {
    const result = computeUnifiedDiff('same\ncontent\n', 'same\ncontent\n')
    expect(result.rows).toHaveLength(0)
    expect(result.additions).toBe(0)
    expect(result.deletions).toBe(0)
    expect(result.truncated).toBe(0)
  })

  it('renders a single-line replacement with paired word-level segments', () => {
    const result = computeUnifiedDiff('const x = 1\n', 'const x = 2\n')
    const removeRow = result.rows.find((r) => r.type === 'remove')
    const addRow = result.rows.find((r) => r.type === 'add')

    expect(removeRow?.content).toBe('const x = 1')
    expect(addRow?.content).toBe('const x = 2')
    expect(removeRow?.segments).toBeDefined()
    expect(addRow?.segments).toBeDefined()
    // The changed word is marked, the shared prefix is not
    expect(removeRow?.segments).toContainEqual({ text: '1', changed: true })
    expect(addRow?.segments).toContainEqual({ text: '2', changed: true })
    expect(removeRow?.segments?.[0]).toEqual({ text: 'const x = ', changed: false })
    expect(result.additions).toBe(1)
    expect(result.deletions).toBe(1)
  })

  it('tracks old/new line numbers across context and changes', () => {
    const old = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n') + '\n'
    const next = ['a', 'b', 'C', 'd', 'e', 'f', 'G'].join('\n') + '\n'
    const result = computeUnifiedDiff(old, next)

    const contextFirst = result.rows.find((r) => r.type === 'context')
    expect(contextFirst?.oldLine).toBe(1)
    expect(contextFirst?.newLine).toBe(1)

    const addRows = result.rows.filter((r) => r.type === 'add')
    expect(addRows.map((r) => r.newLine)).toEqual([3, 7])
    const removeRows = result.rows.filter((r) => r.type === 'remove')
    expect(removeRows.map((r) => r.oldLine)).toEqual([3, 7])
  })

  it('emits hunk header rows with @@ markers', () => {
    const result = computeUnifiedDiff('a\n', 'b\n')
    const hunkRow = result.rows.find((r) => r.type === 'hunk')
    expect(hunkRow?.content).toMatch(/^@@ -1,\d+ \+1,\d+ @@$/)
  })

  it('treats new file creation as all additions', () => {
    const result = computeUnifiedDiff('', 'one\ntwo\n')
    expect(result.additions).toBe(2)
    expect(result.deletions).toBe(0)
    expect(result.rows.every((r) => r.type === 'add' || r.type === 'hunk')).toBe(true)
  })

  it('treats full deletion as all removals', () => {
    const result = computeUnifiedDiff('one\ntwo\n', '')
    expect(result.additions).toBe(0)
    expect(result.deletions).toBe(2)
  })

  it('does not pair word segments across unequal remove/add runs', () => {
    // 2 removes followed by 1 add: only index 0 is paired
    const result = computeUnifiedDiff('hello world\nfoo\n', 'hello brave world\n')
    const removeRows = result.rows.filter((r) => r.type === 'remove')
    expect(removeRows).toHaveLength(2)
    expect(removeRows[0].segments).toBeDefined()
    expect(removeRows[1].segments).toBeUndefined()
  })

  it('skips word segments on very long lines', () => {
    const longA = 'x'.repeat(600) + 'a'
    const longB = 'x'.repeat(600) + 'b'
    const result = computeUnifiedDiff(longA + '\n', longB + '\n')
    const addRow = result.rows.find((r) => r.type === 'add')
    expect(addRow?.segments).toBeUndefined()
    expect(addRow?.content).toBe(longB)
  })

  it('truncates rows beyond maxRows and reports the count', () => {
    const old = Array.from({ length: 50 }, (_, i) => `old-${i}`).join('\n') + '\n'
    const next = Array.from({ length: 50 }, (_, i) => `new-${i}`).join('\n') + '\n'
    const result = computeUnifiedDiff(old, next, 0, 10)
    expect(result.rows).toHaveLength(10)
    expect(result.truncated).toBeGreaterThan(0)
    // Counts are computed before truncation
    expect(result.additions).toBe(50)
    expect(result.deletions).toBe(50)
  })

  it('caps at DIFF_MAX_ROWS by default', () => {
    const old = Array.from({ length: DIFF_MAX_ROWS + 100 }, (_, i) => `o${i}`).join('\n') + '\n'
    const result = computeUnifiedDiff('', old)
    expect(result.rows.length).toBeLessThanOrEqual(DIFF_MAX_ROWS)
    expect(result.truncated).toBeGreaterThan(0)
  })
})

describe('diffStatCounts', () => {
  it('counts additions and deletions without building rows', () => {
    const stats = diffStatCounts('a\nb\nc\n', 'a\nX\nc\nd\n')
    expect(stats.additions).toBe(2)
    expect(stats.deletions).toBe(1)
  })

  it('returns zeros for identical texts', () => {
    expect(diffStatCounts('same\n', 'same\n')).toEqual({ additions: 0, deletions: 0 })
  })
})
