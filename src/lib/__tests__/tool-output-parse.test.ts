import { describe, it, expect } from 'vitest'
import {
  parseReadOutput,
  isReadGap,
  countGrepMatches,
  grepFilePaths,
} from '@/lib/tool-output-parse'

describe('parseReadOutput', () => {
  it('splits tab-prefixed line numbers into real file line numbers', () => {
    const output = '     1\tfirst\n     2\tsecond\n     3\tthird\n'
    const parsed = parseReadOutput(output)
    expect(parsed.lines).toEqual([
      { n: 1, text: 'first' },
      { n: 2, text: 'second' },
      { n: 3, text: 'third' },
    ])
    expect(parsed.footer).toBeNull()
  })

  it('extracts the trailing truncation footer', () => {
    const output = '     9\tninth\n\n... (91 more lines, 100 total)'
    const parsed = parseReadOutput(output)
    expect(parsed.lines).toEqual([{ n: 9, text: 'ninth' }])
    expect(parsed.footer).toBe('... (91 more lines, 100 total)')
  })

  it('marks unprefixed lines with a null line number', () => {
    const parsed = parseReadOutput('no prefix here\n     2\tsecond\n')
    expect(parsed.lines[0]).toEqual({ n: null, text: 'no prefix here' })
    expect(parsed.lines[1]).toEqual({ n: 2, text: 'second' })
  })

  it('supports gap detection between non-contiguous line numbers', () => {
    const parsed = parseReadOutput('     5\ta\n     9\tb\n')
    expect(isReadGap(parsed.lines[0], parsed.lines[1])).toBe(true)
    expect(isReadGap(parsed.lines[0], parsed.lines[0])).toBe(false)
  })
})

describe('countGrepMatches', () => {
  it('counts match lines but not context or separator lines', () => {
    const output = [
      'src/a.ts:12:const x = 1',
      'src/a.ts-13-const y = 2',
      '--',
      'src/b.rs:7:let z = 3',
      'src/b.rs-8-let w = 4',
    ].join('\n')
    expect(countGrepMatches(output)).toBe(2)
  })

  it('returns 0 for empty output', () => {
    expect(countGrepMatches('')).toBe(0)
  })
})

describe('grepFilePaths', () => {
  it('lists unique file paths in first-seen order', () => {
    const output = ['src/b.ts:1:one', 'src/a.ts:2:two', 'src/b.ts:3:three'].join('\n')
    expect(grepFilePaths(output)).toEqual(['src/b.ts', 'src/a.ts'])
  })

  it('ignores separators', () => {
    expect(grepFilePaths('--\nsrc/x.ts:1:x')).toEqual(['src/x.ts'])
  })
})
