import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canRunAnyway, useAutoReviewStore } from '../autoReviewStore'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

describe('autoReviewStore', () => {
  beforeEach(() => {
    invoke.mockReset()
    useAutoReviewStore.getState().reset()
  })

  it('loads persisted markers without overwriting live ones', async () => {
    useAutoReviewStore.getState().receive({
      conversation_id: 'c',
      tool_call_id: 't1',
      decision_id: 'live',
      kind: 'allowed',
      tool_name: 'bash',
      subject: 'ls',
      risk_level: 'low',
      rationale: null,
      suggest_mode_switch: false,
    })
    invoke.mockResolvedValue([
      {
        decisionId: 'old',
        toolCallId: 't1',
        kind: 'denied',
        riskLevel: 'high',
        rationale: 'x',
        overridden: false,
      },
      {
        decisionId: 'd2',
        toolCallId: 't2',
        kind: 'jail_denied',
        riskLevel: null,
        rationale: null,
        overridden: true,
      },
      {
        decisionId: 'd3',
        toolCallId: null,
        kind: 'failed',
        riskLevel: 'bogus',
        rationale: null,
        overridden: false,
      },
    ])
    await useAutoReviewStore.getState().load('c')
    expect(invoke).toHaveBeenCalledWith('list_auto_review_markers', { conversationId: 'c' })
    const markers = useAutoReviewStore.getState().markers
    expect(markers.t1.decisionId).toBe('live')
    expect(markers.t2.kind).toBe('jail_denied')
    expect(canRunAnyway(markers.t2)).toBe(false)
    expect(Object.keys(markers)).toHaveLength(2)
  })

  it('ignores events without a tool call and marks overrides by decision', () => {
    const store = useAutoReviewStore.getState()
    store.receive({
      conversation_id: 'c',
      tool_call_id: null,
      decision_id: 'd',
      kind: 'denied',
      tool_name: 'bash',
      subject: 'x',
      risk_level: null,
      rationale: null,
      suggest_mode_switch: false,
    })
    expect(useAutoReviewStore.getState().markers).toEqual({})
    store.receive({
      conversation_id: 'c',
      tool_call_id: 't',
      decision_id: 'd',
      kind: 'denied',
      tool_name: 'bash',
      subject: 'x',
      risk_level: null,
      rationale: null,
      suggest_mode_switch: false,
    })
    expect(canRunAnyway(useAutoReviewStore.getState().markers.t)).toBe(true)
    store.markOverridden('d')
    expect(useAutoReviewStore.getState().markers.t.overridden).toBe(true)
  })
})
