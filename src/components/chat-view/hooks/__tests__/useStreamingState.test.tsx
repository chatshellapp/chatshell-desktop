import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStreamingState } from '../useStreamingState'
import { useMessageStore, createDefaultConversationState } from '@/stores/message'
import type { StreamingToolCall } from '@/components/attachment-preview/tool-call-preview'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const CONV = 'conv-streaming'
const OTHER = 'conv-other'

const toolCall: StreamingToolCall = {
  id: 'tc-1',
  tool_name: 'bash',
  tool_input: 'ls',
  status: 'running',
  order: 0,
}

function seedConversation(id: string, overrides: Record<string, unknown> = {}) {
  const state = createDefaultConversationState()
  Object.assign(state, overrides)
  useMessageStore.setState((prev) => ({
    conversationStates: { ...prev.conversationStates, [id]: state },
  }))
}

describe('useStreamingState', () => {
  beforeEach(() => {
    useMessageStore.setState({
      conversationStates: {},
      isSending: false,
      error: null,
      onNewConversationCreated: undefined,
    })
  })

  it('returns empty defaults when the conversation has no state yet', () => {
    const { result } = renderHook(() => useStreamingState(CONV))

    expect(result.current.streamingContent).toBe('')
    expect(result.current.streamingReasoningContent).toBe('')
    expect(result.current.isReasoningActive).toBe(false)
    expect(result.current.isWaitingForAI).toBe(false)
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingToolCalls).toEqual({})
    expect(result.current.streamingImages).toEqual([])
    expect(result.current.pendingSearchDecisions).toEqual({})
  })

  it('returns empty defaults for a null conversation id', () => {
    act(() => seedConversation(CONV, { streamingContent: 'partial', isStreaming: true }))

    const { result } = renderHook(() => useStreamingState(null))

    expect(result.current.streamingContent).toBe('')
    expect(result.current.isStreaming).toBe(false)
  })

  it('tracks waiting, streaming and reasoning transitions for the active conversation', () => {
    const { result } = renderHook(() => useStreamingState(CONV))

    // Waiting for the first token
    act(() => seedConversation(CONV, { isWaitingForAI: true }))
    expect(result.current.isWaitingForAI).toBe(true)
    expect(result.current.isStreaming).toBe(false)

    // Reasoning starts before content
    act(() =>
      seedConversation(CONV, {
        isWaitingForAI: false,
        isReasoningActive: true,
        streamingReasoningContent: 'thinking hard',
      })
    )
    expect(result.current.isReasoningActive).toBe(true)
    expect(result.current.streamingReasoningContent).toBe('thinking hard')
    expect(result.current.streamingContent).toBe('')

    // Content and tool calls arrive
    act(() =>
      seedConversation(CONV, {
        isReasoningActive: true,
        streamingReasoningContent: 'thinking hard',
        streamingContent: 'answer so far',
        isStreaming: true,
        streamingToolCalls: { 'tc-1': toolCall },
        streamingImages: ['data:image/png;base64,xyz'],
        pendingSearchDecisions: { 'msg-1': true },
      })
    )
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.streamingContent).toBe('answer so far')
    expect(result.current.streamingToolCalls['tc-1']).toBe(toolCall)
    expect(result.current.streamingImages).toEqual(['data:image/png;base64,xyz'])
    expect(result.current.pendingSearchDecisions).toEqual({ 'msg-1': true })

    // Stream finalized and buffers cleared
    act(() =>
      seedConversation(CONV, {
        isStreaming: false,
        isReasoningActive: false,
      })
    )
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.isReasoningActive).toBe(false)
    expect(result.current.streamingContent).toBe('')
    expect(result.current.streamingReasoningContent).toBe('')
  })

  it('ignores streaming updates from other conversations', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useStreamingState(id),
      {
        initialProps: { id: CONV as string | null },
      }
    )

    act(() => seedConversation(OTHER, { isStreaming: true, streamingContent: 'other stream' }))
    expect(result.current.streamingContent).toBe('')
    expect(result.current.isStreaming).toBe(false)

    // Switching the hook to the other conversation exposes its state
    rerender({ id: OTHER })
    expect(result.current.streamingContent).toBe('other stream')
    expect(result.current.isStreaming).toBe(true)

    // Updates to the original conversation no longer affect the hook
    act(() => seedConversation(CONV, { isStreaming: true, streamingContent: 'active stream' }))
    expect(result.current.streamingContent).toBe('other stream')

    rerender({ id: CONV })
    expect(result.current.streamingContent).toBe('active stream')
  })

  it('keeps stable empty-collection references across unrelated store updates', () => {
    const { result } = renderHook(() => useStreamingState(CONV))
    const initialToolCalls = result.current.streamingToolCalls
    const initialImages = result.current.streamingImages

    act(() => seedConversation(OTHER, { streamingContent: 'noise' }))

    expect(result.current.streamingToolCalls).toBe(initialToolCalls)
    expect(result.current.streamingImages).toBe(initialImages)
  })
})
