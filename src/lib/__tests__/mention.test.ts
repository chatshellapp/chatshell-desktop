import { describe, it, expect } from 'vitest'
import { activeMention, applyMention, rankMentionCandidates } from '../mention'

describe('activeMention', () => {
  it('finds a mention at the start or after whitespace', () => {
    expect(activeMention('@sr', 3)).toEqual({ start: 0, query: 'sr' })
    expect(activeMention('look at @src/ma', 15)).toEqual({ start: 8, query: 'src/ma' })
    expect(activeMention('look @', 6)).toEqual({ start: 5, query: '' })
  })

  it('ignores emails, finished mentions, and text after the caret', () => {
    expect(activeMention('mail me@host', 12)).toBeNull()
    expect(activeMention('@src/main.rs done', 17)).toBeNull()
    expect(activeMention('no mention', 10)).toBeNull()
  })
})

describe('applyMention', () => {
  it('replaces the typed query with the path and a trailing space', () => {
    const text = 'see @ma and more'
    const mention = activeMention(text, 7)!
    expect(applyMention(text, mention, 'src/main.rs')).toEqual({
      text: 'see @src/main.rs  and more',
      caret: 17,
    })
  })
})

describe('rankMentionCandidates', () => {
  const paths = ['docs/main-guide.md', 'src/main.rs', 'src/lib/domain.ts', 'Cargo.toml']

  it('ranks basename prefixes over substrings and subsequences', () => {
    expect(rankMentionCandidates(paths, 'main')).toEqual([
      'src/main.rs',
      'docs/main-guide.md',
      'src/lib/domain.ts',
    ])
    // Subsequence matches, shorter paths first.
    expect(rankMentionCandidates(paths, 'ct')).toEqual(['Cargo.toml', 'src/lib/domain.ts'])
  })

  it('returns everything (shortest first) for an empty query and respects the limit', () => {
    expect(rankMentionCandidates(paths, '', 2)).toEqual(['Cargo.toml', 'src/main.rs'])
  })
})
