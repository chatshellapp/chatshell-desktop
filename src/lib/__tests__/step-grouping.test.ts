import { describe, it, expect } from 'vitest'
import { groupOrderedSteps, splitRunItems, countRunSteps } from '../step-grouping'
import type { ProcessStep } from '@/types'

const makeThinking = (id: string, content: string): ProcessStep => ({
  type: 'thinking',
  id,
  message_id: 'msg-1',
  content,
  source: 'reasoning',
  display_order: 0,
  created_at: '2024-01-01T00:00:00Z',
})

const makeTool = (id: string, status = 'success'): ProcessStep => ({
  type: 'tool_call',
  id,
  call_id: null,
  message_id: 'msg-1',
  tool_name: 'bash',
  tool_input: '{}',
  tool_output: 'done',
  status,
  display_order: 0,
  created_at: '2024-01-01T00:00:00Z',
})

const makeContent = (id: string, content: string): ProcessStep => ({
  type: 'content_block',
  id,
  message_id: 'msg-1',
  content,
  display_order: 0,
  created_at: '2024-01-01T00:00:00Z',
})

const makeSearchDecision = (id: string): ProcessStep => ({
  type: 'search_decision',
  id,
  message_id: 'msg-1',
  reasoning: 'need search',
  search_needed: true,
  display_order: 0,
  created_at: '2024-01-01T00:00:00Z',
})

describe('groupOrderedSteps', () => {
  it('returns an empty array for no steps', () => {
    expect(groupOrderedSteps([])).toEqual([])
  })

  it('keeps every tool call as its own item, completed or not', () => {
    const items = groupOrderedSteps([makeTool('t1'), makeTool('t2'), makeTool('t3', 'running')])
    expect(items.map((i) => [i.kind, i.id])).toEqual([
      ['tool', 't1'],
      ['tool', 't2'],
      ['tool', 't3'],
    ])
  })

  it('merges consecutive thinking and attaches it to the following tool call', () => {
    const items = groupOrderedSteps([
      makeThinking('th1', 'a'),
      makeThinking('th2', 'b'),
      makeTool('t1'),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'tool', data: { thinkingContent: 'a\n\nb' } })
  })

  it('emits thinking not followed by a tool call as its own item', () => {
    const items = groupOrderedSteps([
      makeTool('t1'),
      makeThinking('th1', 'after'),
      makeContent('c1', 'answer'),
      makeThinking('th2', 'tail'),
    ])
    expect(items.map((i) => i.kind)).toEqual(['tool', 'thinking', 'content', 'thinking'])
  })

  it('ignores steps of unrelated kinds', () => {
    expect(groupOrderedSteps([makeSearchDecision('s1'), makeTool('t1')]).map((i) => i.id)).toEqual([
      't1',
    ])
  })
})

describe('splitRunItems', () => {
  it('has no fold without tool calls', () => {
    const items = groupOrderedSteps([makeThinking('th1', 'x'), makeContent('c1', 'answer')])
    expect(splitRunItems(items)).toEqual({ fold: [], after: items })
  })

  it('keeps text between tool calls and thinking after the last one in the fold', () => {
    const items = groupOrderedSteps([
      makeContent('c0', 'let me check'),
      makeTool('t1'),
      makeContent('c1', 'one more'),
      makeTool('t2'),
      makeThinking('th1', 'wrap up'),
      makeContent('c2', 'final answer'),
      makeContent('c3', 'more answer'),
    ])
    const { fold, after } = splitRunItems(items)
    expect(fold.map((i) => i.id)).toEqual(['c0', 't1', 'c1', 't2', 'th1'])
    expect(after.map((i) => i.id)).toEqual(['c2', 'c3'])
  })

  it('folds everything when the run ends on a tool call', () => {
    const items = groupOrderedSteps([makeTool('t1'), makeThinking('th1', 'x')])
    expect(splitRunItems(items)).toEqual({ fold: items, after: [] })
  })
})

describe('countRunSteps', () => {
  it('counts tool calls and thinking blocks, and failed tools', () => {
    const items = groupOrderedSteps([
      makeThinking('th1', 'plan'),
      makeTool('t1'),
      makeContent('c1', 'between'),
      makeTool('t2', 'error'),
      makeThinking('th2', 'after'),
    ])
    expect(countRunSteps(items)).toEqual({ steps: 4, failedTools: 1 })
  })
})
