import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useConversationState } from '../useConversationState'
import { useChatEvents } from '@/hooks/chat-events'
import { useMessageStore, createDefaultConversationState } from '@/stores/message'
import { useConversationStore } from '@/stores/conversation'
import type { Conversation, Message } from '@/types'

vi.mock('@/hooks/chat-events', () => ({
  useChatEvents: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const CONV = 'conv-state'
const NOW = '2026-01-01T00:00:00Z'

const conversation: Conversation = {
  id: CONV,
  title: 'State',
  created_at: NOW,
  updated_at: NOW,
}

const loadMessages = vi.fn()
const clearApiError = vi.fn()

function seedConversation(overrides: Record<string, unknown> = {}) {
  const state = createDefaultConversationState()
  Object.assign(state, overrides)
  act(() => {
    useMessageStore.setState({ conversationStates: { [CONV]: state } })
  })
}

describe('useConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadMessages.mockReset().mockResolvedValue(undefined)
    clearApiError.mockReset()

    useMessageStore.setState({
      conversationStates: {},
      isSending: false,
      error: null,
      onNewConversationCreated: undefined,
      loadMessages,
      clearApiError,
    })
    useConversationStore.setState({
      conversations: [],
      currentConversation: null,
      currentParticipants: [],
      selectedModel: null,
      selectedAssistant: null,
      lastUsedModel: null,
      lastUsedAssistant: null,
      isFirstConversationSinceStartup: false,
      isLoading: false,
      error: null,
      pendingInput: null,
    })
  })

  it('returns neutral defaults when no conversation is active', () => {
    const { result } = renderHook(() => useConversationState())

    expect(result.current.currentConversation).toBeNull()
    expect(result.current.conversationId).toBeNull()
    expect(result.current.messages).toEqual([])
    expect(result.current.hasOlderMessages).toBe(false)
    expect(result.current.isLoadingOlder).toBe(false)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.isWaitingForAI).toBe(false)
    expect(result.current.hasStreamingData).toBe(false)
    expect(result.current.apiError).toBeNull()
    expect(result.current.attachmentStatus).toBe('idle')
    expect(result.current.attachmentRefreshKey).toBe(0)
    expect(result.current.urlStatuses).toEqual({})
    expect(result.current.pendingSearchDecisions).toEqual({})
    expect(result.current.pendingMessages).toEqual([])
    expect(loadMessages).not.toHaveBeenCalled()
    expect(useChatEvents).toHaveBeenCalledWith(null)
  })

  it('loads the message window when a conversation becomes active', () => {
    useConversationStore.setState({ currentConversation: conversation })
    renderHook(() => useConversationState())

    expect(loadMessages).toHaveBeenCalledWith(CONV)
    expect(useChatEvents).toHaveBeenCalledWith(CONV)
  })

  it('exposes the low-frequency window state for the active conversation', () => {
    useConversationStore.setState({ currentConversation: conversation })
    const messages: Message[] = [
      { id: 'm1', conversation_id: CONV, sender_type: 'user', content: 'hi', created_at: NOW },
    ]
    seedConversation({
      messages,
      hasOlderMessages: true,
      isLoadingOlder: true,
      isLoading: true,
      apiError: 'boom',
      attachmentStatus: 'processing',
      attachmentRefreshKey: 3,
      urlStatuses: { m1: { 'https://example.com': 'fetching' } },
      pendingSearchDecisions: { m1: true },
      pendingMessages: [
        {
          content: 'queued',
          conversationId: CONV,
          provider: 'openai',
          model: 'gpt-4o',
        },
      ],
    })

    const { result } = renderHook(() => useConversationState())

    expect(result.current.messages).toEqual(messages)
    expect(result.current.hasOlderMessages).toBe(true)
    expect(result.current.isLoadingOlder).toBe(true)
    expect(result.current.isLoading).toBe(true)
    expect(result.current.apiError).toBe('boom')
    expect(result.current.attachmentStatus).toBe('processing')
    expect(result.current.attachmentRefreshKey).toBe(3)
    expect(result.current.urlStatuses).toEqual({ m1: { 'https://example.com': 'fetching' } })
    expect(result.current.pendingSearchDecisions).toEqual({ m1: true })
    expect(result.current.pendingMessages).toHaveLength(1)
  })

  describe('hasStreamingData', () => {
    it.each([
      ['streaming content', { streamingContent: 'partial answer' }],
      ['streaming reasoning', { streamingReasoningContent: 'thinking' }],
      ['streaming tool calls', { streamingToolCalls: { t1: { id: 't1', order: 0 } as never } }],
      ['streaming images', { streamingImages: ['data:image/png;base64,x'] }],
    ])('flips true while %s is present and back to false once cleared', (_label, overrides) => {
      useConversationStore.setState({ currentConversation: conversation })
      const { result } = renderHook(() => useConversationState())
      expect(result.current.hasStreamingData).toBe(false)

      seedConversation(overrides)
      expect(result.current.hasStreamingData).toBe(true)

      seedConversation({})
      expect(result.current.hasStreamingData).toBe(false)
    })
  })

  describe('handleClearApiError', () => {
    it('clears the api error for the active conversation', () => {
      useConversationStore.setState({ currentConversation: conversation })
      const { result } = renderHook(() => useConversationState())

      act(() => {
        result.current.handleClearApiError()
      })

      expect(clearApiError).toHaveBeenCalledWith(CONV)
    })

    it('does nothing without an active conversation', () => {
      const { result } = renderHook(() => useConversationState())

      act(() => {
        result.current.handleClearApiError()
      })

      expect(clearApiError).not.toHaveBeenCalled()
    })
  })
})
