import { describe, it, expect } from 'vitest'
import { filterGroups, filterItems, matchesQuery, normalizeQuery } from '../sidebar-filter'

type Group = { name: string; items: { name: string; note?: string }[] }
const groups: Group[] = [
  { name: 'OpenAI', items: [{ name: 'gpt-5' }, { name: 'o4-mini' }] },
  {
    name: 'Anthropic',
    items: [{ name: 'claude-opus', note: 'reasoning' }, { name: 'claude-haiku' }],
  },
]
const run = (query: string) =>
  filterGroups(
    groups,
    normalizeQuery(query),
    (g) => g.items,
    (g, items) => ({ ...g, items }),
    (i) => [i.name, i.note]
  )

describe('sidebar-filter', () => {
  it('treats blank queries as no filter', () => {
    expect(normalizeQuery('   ')).toBeNull()
    expect(normalizeQuery(' GPT ')).toBe('gpt')
    expect(run('')).toBe(groups)
    expect(matchesQuery(null, [])).toBe(true)
  })

  it('keeps only matching items, case-insensitively, across any field', () => {
    expect(run('HAIKU')).toEqual([{ name: 'Anthropic', items: [{ name: 'claude-haiku' }] }])
    expect(run('reason')[0].items.map((i) => i.name)).toEqual(['claude-opus'])
  })

  it('keeps a whole group when its own name matches', () => {
    expect(run('openai')).toEqual([groups[0]])
  })

  it('drops groups left empty', () => {
    expect(run('nothing-matches')).toEqual([])
  })

  it('filters flat lists and ignores missing fields', () => {
    const items = [
      { name: 'a', d: undefined },
      { name: 'b', d: 'match me' },
    ]
    expect(filterItems(items, normalizeQuery('match'), (i) => [i.name, i.d])).toEqual([items[1]])
  })
})
