import { describe, it, expect } from 'vitest'
import { groupOrderedSteps } from '../step-grouping'
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

  it('keeps a lone completed tool call as an individual item', () => {
    const result = groupOrderedSteps([makeTool('t1')])

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      kind: 'tool',
      id: 't1',
      data: { toolCall: expect.objectContaining({ id: 't1' }), thinkingContent: undefined },
    })
  })

  it('groups a run of completed tool calls under the first tool id', () => {
    const result = groupOrderedSteps([makeTool('t1'), makeTool('t2'), makeTool('t3')])

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('tool-group')
    if (result[0].kind !== 'tool-group') return
    expect(result[0].id).toBe('group-t1')
    expect(result[0].items.map((item) => item.toolCall.id)).toEqual(['t1', 't2', 't3'])
  })

  it('attaches preceding thinking to the following tool call', () => {
    const result = groupOrderedSteps([makeThinking('th1', 'let me check'), makeTool('t1')])

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('tool-group')
    if (result[0].kind !== 'tool-group') return
    expect(result[0].items).toHaveLength(1)
    expect(result[0].items[0].thinkingContent).toBe('let me check')
  })

  it('merges consecutive thinking steps into one block before a tool call', () => {
    const result = groupOrderedSteps([
      makeThinking('th1', 'first'),
      makeThinking('th2', 'second'),
      makeTool('t1'),
      makeTool('t2'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('tool-group')
    if (result[0].kind !== 'tool-group') return
    expect(result[0].items[0].thinkingContent).toBe('first\n\nsecond')
  })

  it('groups a single tool call once its thinking raises the row count', () => {
    const result = groupOrderedSteps([makeThinking('th1', 'plan'), makeTool('t1')])

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('tool-group')
    if (result[0].kind !== 'tool-group') return
    expect(result[0].items).toHaveLength(1)
    expect(result[0].items[0].toolCall.id).toBe('t1')
  })

  it('keeps one group across thinking that precedes the next tool call', () => {
    const result = groupOrderedSteps([
      makeTool('t1'),
      makeTool('t2'),
      makeThinking('th1', 'before t3'),
      makeTool('t3'),
      makeTool('t4'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('tool-group')
    if (result[0].kind !== 'tool-group') return
    expect(result[0].items.map((item) => item.toolCall.id)).toEqual(['t1', 't2', 't3', 't4'])
    expect(result[0].items[2].thinkingContent).toBe('before t3')
  })

  it('emits trailing thinking as a standalone item after a running tool call', () => {
    const result = groupOrderedSteps([makeTool('t1', 'running'), makeThinking('th1', 'orphan')])

    expect(result).toHaveLength(2)
    expect(result[0].kind).toBe('tool')
    expect(result[1]).toEqual({ kind: 'thinking', id: 'th1', content: 'orphan' })
  })

  it('concatenates multiple trailing thinking blocks absorbed by one tool', () => {
    const result = groupOrderedSteps([
      makeTool('t1'),
      makeThinking('th1', 'first'),
      makeThinking('th2', 'second'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('tool-group')
    if (result[0].kind !== 'tool-group') return
    expect(result[0].items[0].trailingThinkingContent).toBe('first\n\nsecond')
  })

  it('emits a running tool call as an individual item and flushes the pending group', () => {
    const result = groupOrderedSteps([
      makeTool('t1'),
      makeTool('t2', 'running'),
      makeTool('t3', 'success'),
    ])

    expect(result).toHaveLength(3)
    expect(result.map((item) => item.kind)).toEqual(['tool', 'tool', 'tool'])
    expect(result.map((item) => item.id)).toEqual(['t1', 't2', 't3'])
    expect(result[0].kind).toBe('tool')
    if (result[0].kind !== 'tool') return
    expect(result[0].data.thinkingContent).toBeUndefined()
  })

  it('attaches thinking to a running tool call without grouping it', () => {
    const result = groupOrderedSteps([makeThinking('th1', 'planning'), makeTool('t1', 'running')])

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('tool')
    if (result[0].kind !== 'tool') return
    expect(result[0].data.thinkingContent).toBe('planning')
  })

  it('splits pending thinking into its own item before a content block', () => {
    const result = groupOrderedSteps([
      makeThinking('th1', 'pre content'),
      makeContent('c1', 'hello'),
    ])

    expect(result).toEqual([
      { kind: 'thinking', id: 'th1', content: 'pre content' },
      { kind: 'content', id: 'c1', content: 'hello' },
    ])
  })

  it('flushes the open group when a content block appears between tool runs', () => {
    const result = groupOrderedSteps([
      makeTool('t1'),
      makeTool('t2'),
      makeContent('c1', 'middle'),
      makeTool('t3'),
      makeTool('t4'),
    ])

    expect(result).toHaveLength(3)
    expect(result[0].kind).toBe('tool-group')
    expect(result[1]).toEqual({ kind: 'content', id: 'c1', content: 'middle' })
    expect(result[2].kind).toBe('tool-group')
    if (result[0].kind !== 'tool-group' || result[2].kind !== 'tool-group') return
    expect(result[0].id).toBe('group-t1')
    expect(result[2].id).toBe('group-t3')
  })

  it('keeps a final thinking step after a content block as a thinking item', () => {
    const result = groupOrderedSteps([makeContent('c1', 'text'), makeThinking('th1', 'tail')])

    expect(result).toEqual([
      { kind: 'content', id: 'c1', content: 'text' },
      { kind: 'thinking', id: 'th1', content: 'tail' },
    ])
  })

  it('ignores steps of unrelated kinds', () => {
    const result = groupOrderedSteps([
      makeSearchDecision('sd1'),
      makeTool('t1'),
      makeSearchDecision('sd2'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('tool')
    expect(result[0].id).toBe('t1')
  })
})
