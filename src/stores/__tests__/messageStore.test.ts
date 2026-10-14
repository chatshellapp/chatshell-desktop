import { invoke } from '@tauri-apps/api/core'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useMessageStore, createDefaultConversationState } from '../message'
import type { Message } from '@/types'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock Tauri event
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}))

// Mock logger to avoid console noise
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

const createMockMessage = (id: string, content: string, sender_type: string = 'user'): Message => ({
  id,
  conversation_id: 'conv-1',
  sender_type,
  content,
  created_at: '2024-01-01T00:00:00Z',
})

describe('useMessageStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Reset store state to initial values
    useMessageStore.setState({
      conversationStates: {},
      isSending: false,
      error: null,
      onNewConversationCreated: undefined,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('should have empty conversationStates', () => {
      const state = useMessageStore.getState()
      expect(state.conversationStates).toEqual({})
    })

    it('should not be sending initially', () => {
      const state = useMessageStore.getState()
      expect(state.isSending).toBe(false)
    })

    it('should have no error initially', () => {
      const state = useMessageStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('createDefaultConversationState', () => {
    it('should create default state with correct values', () => {
      const state = createDefaultConversationState()

      expect(state.messages).toEqual([])
      expect(state.isLoading).toBe(false)
      expect(state.isStreaming).toBe(false)
      expect(state.streamingContent).toBe('')
      expect(state.streamingReasoningContent).toBe('')
      expect(state.isReasoningActive).toBe(false)
      expect(state.isWaitingForAI).toBe(false)
      expect(state.attachmentStatus).toBe('idle')
      expect(state.attachmentRefreshKey).toBe(0)
      expect(state.urlStatuses).toEqual({})
      expect(state.pendingSearchDecisions).toEqual({})
      expect(state.apiError).toBeNull()
      expect(state.streamingToolCalls).toEqual({})
    })
  })

  describe('getConversationState', () => {
    it('should create default state for new conversation', () => {
      const state = useMessageStore.getState().getConversationState('new-conv')

      expect(state).toEqual(createDefaultConversationState())
    })

    it('should return existing state for known conversation', () => {
      const customState = {
        ...createDefaultConversationState(),
        isStreaming: true,
        streamingContent: 'Hello',
      }
      useMessageStore.setState({
        conversationStates: { 'conv-1': customState },
      })

      const state = useMessageStore.getState().getConversationState('conv-1')

      expect(state.isStreaming).toBe(true)
      expect(state.streamingContent).toBe('Hello')
    })
  })

  describe('setStreamingContent', () => {
    it('should set streaming content for conversation', () => {
      useMessageStore.getState().setStreamingContent('conv-1', 'Hello world')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.streamingContent).toBe('Hello world')
    })

    it('should clear reasoning content when streaming content is cleared', () => {
      // First set some reasoning content
      const initialState = {
        ...createDefaultConversationState(),
        streamingContent: 'content',
        streamingReasoningContent: 'reasoning',
      }
      useMessageStore.setState({
        conversationStates: { 'conv-1': initialState },
      })

      // Clear streaming content
      useMessageStore.getState().setStreamingContent('conv-1', '')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.streamingContent).toBe('')
      expect(state.streamingReasoningContent).toBe('')
    })
  })

  describe('setIsStreaming', () => {
    it('should set streaming status', () => {
      useMessageStore.getState().setIsStreaming('conv-1', true)

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.isStreaming).toBe(true)
    })

    it('should reset reasoning state when streaming ends', () => {
      // Set up initial streaming state with reasoning
      const initialState = {
        ...createDefaultConversationState(),
        isStreaming: true,
        isReasoningActive: true,
        streamingReasoningContent: 'thinking...',
      }
      useMessageStore.setState({
        conversationStates: { 'conv-1': initialState },
      })

      // End streaming
      useMessageStore.getState().setIsStreaming('conv-1', false)

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.isStreaming).toBe(false)
      expect(state.isReasoningActive).toBe(false)
      expect(state.streamingReasoningContent).toBe('')
    })
  })

  describe('appendStreamingChunk', () => {
    it('should append chunk to streaming content after throttle', () => {
      useMessageStore.getState().setIsStreaming('conv-1', true)
      useMessageStore.getState().appendStreamingChunk('conv-1', 'Hello')
      useMessageStore.getState().appendStreamingChunk('conv-1', ' World')

      // Fast-forward past the throttle delay
      vi.advanceTimersByTime(50)

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.streamingContent).toBe('Hello World')
    })

    it('should set isWaitingForAI to false after append', () => {
      const initialState = {
        ...createDefaultConversationState(),
        isStreaming: true,
        isWaitingForAI: true,
      }
      useMessageStore.setState({
        conversationStates: { 'conv-1': initialState },
      })

      useMessageStore.getState().appendStreamingChunk('conv-1', 'chunk')
      vi.advanceTimersByTime(50)

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.isWaitingForAI).toBe(false)
    })
  })

  describe('setIsWaitingForAI', () => {
    it('should set waiting status', () => {
      useMessageStore.getState().setIsWaitingForAI('conv-1', true)

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.isWaitingForAI).toBe(true)
    })
  })

  describe('setIsReasoningActive', () => {
    it('should set reasoning active status', () => {
      useMessageStore.getState().setIsReasoningActive('conv-1', true)

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.isReasoningActive).toBe(true)
    })
  })

  describe('addMessage', () => {
    it('should add message to conversation', () => {
      const message = createMockMessage('msg-1', 'Hello')

      useMessageStore.getState().addMessage('conv-1', message)

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.messages).toContainEqual(message)
    })
  })

  describe('setAttachmentStatus', () => {
    it('should set attachment status', () => {
      useMessageStore.getState().setAttachmentStatus('conv-1', 'processing')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.attachmentStatus).toBe('processing')
    })
  })

  describe('incrementAttachmentRefreshKey', () => {
    it('should increment refresh key', () => {
      useMessageStore.getState().incrementAttachmentRefreshKey('conv-1')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.attachmentRefreshKey).toBe(1)
    })

    it('should increment multiple times', () => {
      useMessageStore.getState().incrementAttachmentRefreshKey('conv-1')
      useMessageStore.getState().incrementAttachmentRefreshKey('conv-1')
      useMessageStore.getState().incrementAttachmentRefreshKey('conv-1')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.attachmentRefreshKey).toBe(3)
    })
  })

  describe('setApiError', () => {
    it('should set API error', () => {
      useMessageStore.getState().setApiError('conv-1', 'API rate limit exceeded')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.apiError).toBe('API rate limit exceeded')
    })
  })

  describe('clearApiError', () => {
    it('should clear API error', () => {
      useMessageStore.getState().setApiError('conv-1', 'Some error')
      useMessageStore.getState().clearApiError('conv-1')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.apiError).toBeNull()
    })
  })

  describe('cleanupConversation', () => {
    it('should reset streaming state for conversation', () => {
      // Set up some state
      const initialState = {
        ...createDefaultConversationState(),
        isStreaming: true,
        streamingContent: 'content',
        streamingReasoningContent: 'reasoning',
        isWaitingForAI: true,
        attachmentStatus: 'processing' as const,
      }
      useMessageStore.setState({
        conversationStates: { 'conv-1': initialState },
      })

      useMessageStore.getState().cleanupConversation('conv-1')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.isStreaming).toBe(false)
      expect(state.streamingContent).toBe('')
      expect(state.streamingReasoningContent).toBe('')
      expect(state.isWaitingForAI).toBe(false)
      expect(state.attachmentStatus).toBe('idle')
    })
  })

  describe('removeConversationState', () => {
    it('should remove conversation state entirely', () => {
      useMessageStore.setState({
        conversationStates: {
          'conv-1': createDefaultConversationState(),
          'conv-2': createDefaultConversationState(),
        },
      })

      useMessageStore.getState().removeConversationState('conv-1')

      const states = useMessageStore.getState().conversationStates
      expect(states['conv-1']).toBeUndefined()
      expect(states['conv-2']).toBeDefined()
    })
  })

  describe('URL status actions', () => {
    it('should set URL statuses', () => {
      useMessageStore
        .getState()
        .setUrlStatuses('conv-1', 'msg-1', ['https://example.com', 'https://test.org'])

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.urlStatuses['msg-1']['https://example.com']).toBe('fetching')
      expect(state.urlStatuses['msg-1']['https://test.org']).toBe('fetching')
    })

    it('should mark URL as fetched', () => {
      useMessageStore.getState().setUrlStatuses('conv-1', 'msg-1', ['https://example.com'])
      useMessageStore.getState().markUrlFetched('conv-1', 'msg-1', 'https://example.com')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.urlStatuses['msg-1']['https://example.com']).toBe('fetched')
    })

    it('should clear URL statuses for message', () => {
      useMessageStore.getState().setUrlStatuses('conv-1', 'msg-1', ['https://example.com'])
      useMessageStore.getState().clearUrlStatuses('conv-1', 'msg-1')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.urlStatuses['msg-1']).toBeUndefined()
    })
  })

  describe('Search decision actions', () => {
    it('should set pending search decision', () => {
      useMessageStore.getState().setPendingSearchDecision('conv-1', 'msg-1', true)

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.pendingSearchDecisions['msg-1']).toBe(true)
    })

    it('should clear pending search decisions', () => {
      useMessageStore.getState().setPendingSearchDecision('conv-1', 'msg-1', true)
      useMessageStore.getState().clearPendingSearchDecisions('conv-1')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.pendingSearchDecisions).toEqual({})
    })
  })

  describe('Tool call streaming actions', () => {
    it('should add streaming tool call', () => {
      useMessageStore
        .getState()
        .addStreamingToolCall('conv-1', 'tool-call-1', 'web_search', '{"query": "test"}')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.streamingToolCalls['tool-call-1']).toBeDefined()
      expect(state.streamingToolCalls['tool-call-1'].tool_name).toBe('web_search')
      expect(state.streamingToolCalls['tool-call-1'].status).toBe('running')
    })

    it('should update streaming tool call with output', () => {
      useMessageStore.getState().addStreamingToolCall('conv-1', 'tool-call-1', 'web_search', '{}')
      useMessageStore
        .getState()
        .updateStreamingToolCall('conv-1', 'tool-call-1', 'Search results here')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.streamingToolCalls['tool-call-1'].tool_output).toBe('Search results here')
      expect(state.streamingToolCalls['tool-call-1'].status).toBe('success')
    })

    it('should clear streaming tool calls', () => {
      useMessageStore.getState().addStreamingToolCall('conv-1', 'tool-call-1', 'test', '{}')
      useMessageStore.getState().addStreamingToolCall('conv-1', 'tool-call-2', 'test2', '{}')

      useMessageStore.getState().clearStreamingToolCalls('conv-1')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.streamingToolCalls).toEqual({})
    })

    it('should capture content before tool call', () => {
      // Set initial streaming content
      useMessageStore.getState().setStreamingContent('conv-1', 'Previous content')

      // Add tool call
      useMessageStore.getState().addStreamingToolCall('conv-1', 'tool-call-1', 'web_search', '{}')

      const state = useMessageStore.getState().getConversationState('conv-1')
      expect(state.streamingToolCalls['tool-call-1'].contentBefore).toBe('Previous content')
    })
  })

  describe('message window pagination', () => {
    const invokeMock = vi.mocked(invoke)

    const page = (count: number, prefix: string, startTs = 0) =>
      Array.from({ length: count }, (_, i) => ({
        ...createMockMessage(`${prefix}${i}`, `content ${prefix}${i}`),
        created_at: new Date(2026, 0, 1, 0, 0, startTs + i).toISOString(),
      }))

    it('loadMessages fetches a bounded tail window and flags older history', async () => {
      invokeMock.mockResolvedValueOnce(page(101, 'm'))
      await useMessageStore.getState().loadMessages('conv-p')

      const cs = useMessageStore.getState().getConversationState('conv-p')
      expect(cs.messages.length).toBe(100)
      expect(cs.messages[0].id).toBe('m1') // extra oldest row dropped
      expect(cs.messages[99].id).toBe('m100')
      expect(cs.hasOlderMessages).toBe(true)
      expect(invokeMock).toHaveBeenCalledWith('list_messages_by_conversation', {
        conversationId: 'conv-p',
        limit: 101,
      })
    })

    it('loadMessages marks history complete when the window covers everything', async () => {
      invokeMock.mockResolvedValueOnce(page(7, 'm'))
      await useMessageStore.getState().loadMessages('conv-p')

      const cs = useMessageStore.getState().getConversationState('conv-p')
      expect(cs.messages.length).toBe(7)
      expect(cs.hasOlderMessages).toBe(false)
    })

    it('loadOlderMessages prepends the previous page using the oldest cursor', async () => {
      invokeMock.mockResolvedValueOnce(page(101, 'm'))
      await useMessageStore.getState().loadMessages('conv-p')
      const oldestLoaded = useMessageStore.getState().getConversationState('conv-p').messages[0]

      invokeMock.mockResolvedValueOnce(page(50, 'old'))
      const loaded = await useMessageStore.getState().loadOlderMessages('conv-p')

      const cs = useMessageStore.getState().getConversationState('conv-p')
      expect(loaded).toBe(true)
      expect(cs.messages.length).toBe(150)
      expect(cs.messages[0].id).toBe('old0')
      expect(cs.hasOlderMessages).toBe(false) // short page means exhausted
      expect(cs.isLoadingOlder).toBe(false)
      expect(invokeMock).toHaveBeenLastCalledWith('list_messages_by_conversation', {
        conversationId: 'conv-p',
        limit: 101,
        beforeCreatedAt: oldestLoaded.created_at,
        beforeId: oldestLoaded.id,
      })
    })

    it('loadOlderMessages is a no-op while a page load is in flight or history is exhausted', async () => {
      invokeMock.mockResolvedValueOnce(page(5, 'm'))
      await useMessageStore.getState().loadMessages('conv-p')

      const first = useMessageStore.getState().loadOlderMessages('conv-p')
      const second = await useMessageStore.getState().loadOlderMessages('conv-p')
      await first

      expect(second).toBe(false)
      expect(invokeMock).toHaveBeenCalledTimes(1)
    })

    it('ensureMessageLoaded pages upward until the target message is present', async () => {
      invokeMock.mockResolvedValueOnce(page(101, 'm'))
      await useMessageStore.getState().loadMessages('conv-p')

      invokeMock.mockImplementation(async (_cmd: string, args: unknown) => {
        const { beforeId } = args as { beforeId: string }
        // Second page contains the target 'old42'; third page would be empty.
        if (beforeId === 'm1') return page(100, 'old')
        return []
      })
      await useMessageStore.getState().ensureMessageLoaded('conv-p', 'old42')

      const cs = useMessageStore.getState().getConversationState('conv-p')
      expect(cs.messages.some((m) => m.id === 'old42')).toBe(true)
    })
  })
})
