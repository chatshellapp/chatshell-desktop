import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { renderHook } from '@testing-library/react'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import i18n from '@/lib/i18n'
import { useChatEvents } from '../useChatEvents'
import { useMessageStore } from '@/stores/message'
import { useConversationStore } from '@/stores/conversation'
import { useMcpStore } from '@/stores/mcpStore'
import { cleanupThrottleState, THROTTLE_MS } from '@/stores/message/throttle'
import type { Message } from '@/types'

// Capture the handler each listen() registration installs, keyed by event
// name, plus the unlisten callback it resolves with.
const { listeners, unlisteners } = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown) => void>(),
  unlisteners: new Map<string, () => void>(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, handler: (event: unknown) => void): Promise<() => void> => {
    listeners.set(name, handler)
    const unlisten = vi.fn()
    unlisteners.set(name, unlisten)
    return Promise.resolve(unlisten)
  }),
  emit: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// Initialize i18n so useTranslation('messages') resolves real copy
void i18n

const CONV = 'conv-1'

function emit(name: string, payload: unknown) {
  const handler = listeners.get(name)
  if (!handler) throw new Error(`no listener registered for "${name}"`)
  handler({ payload })
}

function convState() {
  return useMessageStore.getState().getConversationState(CONV)
}

function makeMessage(id: string, content: string): Message {
  return {
    id,
    conversation_id: CONV,
    sender_type: 'assistant',
    content,
    created_at: '2026-01-01T00:00:00Z',
  }
}

/** Mark the conversation as actively streaming, as sendMessage does before
 * the backend starts emitting stream events. */
function beginStreaming() {
  useMessageStore.getState().setIsStreaming(CONV, true)
  useMessageStore.getState().setIsWaitingForAI(CONV, true)
}

function setupHook(id: string | null = CONV) {
  return renderHook((convId: string | null) => useChatEvents(convId), {
    initialProps: id,
  })
}

// The exact event set the Rust streaming pipeline emits
// (src-tauri/src/commands/chat/streaming.rs and friends). The hook must
// subscribe to each name once; payload field names are snake_case on the wire.
const BACKEND_EVENTS = [
  'attachment-processing-complete',
  'attachment-processing-error',
  'attachment-processing-started',
  'attachment-update',
  'chat-complete',
  'chat-error',
  'chat-stream',
  'chat-stream-image',
  'chat-stream-reasoning',
  'chat-warning',
  'conversation-updated',
  'generation-stopped',
  'mcp-auth-required',
  'reasoning-started',
  'search-decision-complete',
  'search-decision-started',
  'tool-call-completed',
  'tool-call-started',
]

describe('useChatEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.clear()
    unlisteners.clear()
    vi.useFakeTimers()
    cleanupThrottleState(CONV)
    useMessageStore.setState({
      conversationStates: {},
      isSending: false,
      error: null,
      onNewConversationCreated: undefined,
      sendMessage: vi.fn(),
    })
    useConversationStore.setState({
      conversations: [],
      currentConversation: null,
      currentParticipants: [],
      selectedModel: null,
      selectedAssistant: null,
      lastUsedModel: null,
      lastUsedAssistant: null,
      isLoading: false,
      error: null,
    })
    useMcpStore.setState({ probeEndpoint: vi.fn() })
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanupThrottleState(CONV)
  })

  describe('subscription lifecycle', () => {
    it('subscribes exactly once to every backend stream event', () => {
      setupHook()

      expect([...listeners.keys()].sort()).toEqual(BACKEND_EVENTS)
      expect(listen).toHaveBeenCalledTimes(BACKEND_EVENTS.length)
      for (const name of BACKEND_EVENTS) {
        expect(listen).toHaveBeenCalledWith(name, expect.any(Function))
      }
    })

    it('subscribes to nothing without a conversation', () => {
      setupHook(null)

      expect(listeners.size).toBe(0)
      expect(listen).not.toHaveBeenCalled()
    })

    it('unsubscribes every listener on unmount', async () => {
      const { unmount } = setupHook()
      unmount()
      // Cleanup runs the resolved unlisten promises on a microtask
      await Promise.resolve()

      expect(unlisteners.size).toBe(BACKEND_EVENTS.length)
      for (const [name, unlisten] of unlisteners) {
        expect(unlisten, `unlisten for ${name}`).toHaveBeenCalledTimes(1)
      }
    })

    it('resubscribes when the conversation changes', async () => {
      const { rerender } = setupHook()
      const firstConversationUnlisteners = [...unlisteners.values()]
      rerender('conv-2')
      await Promise.resolve()

      // Old conversation's listeners were torn down
      for (const unlisten of firstConversationUnlisteners) {
        expect(unlisten).toHaveBeenCalledTimes(1)
      }
      expect(listen).toHaveBeenCalledTimes(BACKEND_EVENTS.length * 2)
    })
  })

  describe('streaming turn (contract with backend agent_streaming)', () => {
    it('routes a full assistant turn through the message store', () => {
      beginStreaming()
      setupHook()

      // reasoning-started arrives before the first reasoning chunk
      emit('reasoning-started', { conversation_id: CONV })
      expect(convState().isReasoningActive).toBe(true)

      // Reasoning chunks accumulate in order under the store's throttle
      emit('chat-stream-reasoning', { conversation_id: CONV, content: 'Think ' })
      emit('chat-stream-reasoning', { conversation_id: CONV, content: 'step 1' })
      vi.advanceTimersByTime(THROTTLE_MS)
      expect(convState().streamingReasoningContent).toBe('Think step 1')

      // Content chunks flush together; waiting spinner clears
      emit('chat-stream', { conversation_id: CONV, content: 'Hello ' })
      emit('chat-stream', { conversation_id: CONV, content: 'world' })
      vi.advanceTimersByTime(THROTTLE_MS)
      expect(convState().streamingContent).toBe('Hello world')
      expect(convState().isWaitingForAI).toBe(false)

      // MCP tool call interleaves with the streamed content
      emit('tool-call-started', {
        conversation_id: CONV,
        tool_call_id: 'tc-1',
        tool_name: 'web_search',
        tool_input: '{"query":"chatshell"}',
      })
      expect(convState().streamingToolCalls['tc-1']).toMatchObject({
        tool_name: 'web_search',
        tool_input: '{"query":"chatshell"}',
        status: 'running',
        contentBefore: 'Hello world',
      })

      emit('tool-call-completed', {
        conversation_id: CONV,
        tool_call_id: 'tc-1',
        tool_name: 'web_search',
        tool_input: '{"query":"chatshell"}',
        tool_output: '10 results',
      })
      expect(convState().streamingToolCalls['tc-1']).toMatchObject({
        status: 'success',
        tool_output: '10 results',
      })

      // Generated image streams in
      emit('chat-stream-image', {
        conversation_id: CONV,
        image_url: 'data:image/png;base64,AAA=',
      })
      expect(convState().streamingImages).toEqual(['data:image/png;base64,AAA='])

      // Completion saves the message and resets the streaming state
      emit('chat-complete', { conversation_id: CONV, message: makeMessage('msg-1', 'Hello world') })
      expect(convState().messages).toEqual([makeMessage('msg-1', 'Hello world')])
      expect(convState().isStreaming).toBe(false)
      expect(convState().streamingContent).toBe('')
      expect(convState().streamingReasoningContent).toBe('')
      expect(convState().streamingImages).toEqual([])
      expect(convState().streamingToolCalls).toEqual({})
      expect(convState().isWaitingForAI).toBe(false)
    })

    it('drops content chunks that arrive before streaming starts', () => {
      setupHook()

      emit('chat-stream', { conversation_id: CONV, content: 'early chunk' })
      vi.advanceTimersByTime(THROTTLE_MS)

      expect(convState().streamingContent).toBe('')
    })

    it('keeps chunks of different conversations isolated', () => {
      beginStreaming()
      useMessageStore.getState().setIsStreaming('conv-2', true)
      setupHook()

      emit('chat-stream', { conversation_id: CONV, content: 'mine' })
      emit('chat-stream', { conversation_id: 'conv-2', content: 'theirs' })
      vi.advanceTimersByTime(THROTTLE_MS)

      expect(convState().streamingContent).toBe('mine')
      expect(useMessageStore.getState().getConversationState('conv-2').streamingContent).toBe(
        'theirs'
      )
    })
  })

  describe('chat-complete', () => {
    it('stops streaming without adding a message when the payload is null', () => {
      beginStreaming()
      setupHook()
      useMessageStore.getState().setStreamingContent(CONV, 'partial')

      emit('chat-complete', { conversation_id: CONV, message: null })

      expect(convState().messages).toEqual([])
      expect(convState().isStreaming).toBe(false)
      expect(convState().streamingContent).toBe('')
    })

    it('replaces an existing message with the same id instead of duplicating', () => {
      beginStreaming()
      setupHook()

      emit('chat-complete', { conversation_id: CONV, message: makeMessage('msg-1', 'draft') })
      emit('chat-complete', { conversation_id: CONV, message: makeMessage('msg-1', 'final') })

      expect(convState().messages).toEqual([makeMessage('msg-1', 'final')])
    })

    it('dequeues the next pending message and forwards it to sendMessage', () => {
      beginStreaming()
      setupHook()
      const sendMessage = useMessageStore.getState().sendMessage as Mock
      useMessageStore.setState((state) => {
        state.conversationStates[CONV].pendingMessages = [
          {
            content: 'queued',
            conversationId: CONV,
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: 'sk',
            baseUrl: 'https://api.example.com',
            apiStyle: 'responses',
            includeHistory: undefined,
            systemPrompt: 'sys',
            userPrompt: undefined,
            modelDbId: 'model-1',
            assistantDbId: undefined,
            urlsToFetch: undefined,
            images: undefined,
            files: undefined,
            searchEnabled: false,
            parameterOverrides: undefined,
            contextMessageCount: undefined,
            useProviderDefaults: false,
            reuseFetchResultIds: undefined,
          },
          {
            content: 'still queued',
            conversationId: CONV,
            provider: 'openai',
            model: 'gpt-4o',
          },
        ]
        return state
      })

      emit('chat-complete', { conversation_id: CONV, message: makeMessage('msg-1', 'done') })

      expect(sendMessage).toHaveBeenCalledTimes(1)
      expect(sendMessage).toHaveBeenCalledWith(
        'queued',
        CONV,
        'openai',
        'gpt-4o',
        'sk',
        'https://api.example.com',
        'responses',
        undefined,
        'sys',
        undefined,
        'model-1',
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        false,
        undefined
      )
      expect(convState().pendingMessages).toHaveLength(1)
      expect(convState().pendingMessages[0].content).toBe('still queued')
    })
  })

  describe('chat-error', () => {
    it('records the error and resets the streaming state', () => {
      beginStreaming()
      setupHook()
      useMessageStore.getState().setStreamingContent(CONV, 'partial answer')
      useMessageStore.getState().addStreamingToolCall(CONV, 'tc-1', 'web_search', '{}')

      emit('chat-error', { conversation_id: CONV, error: 'rate limited' })

      expect(convState().apiError).toBe('rate limited')
      expect(convState().isStreaming).toBe(false)
      expect(convState().isWaitingForAI).toBe(false)
      expect(convState().streamingContent).toBe('')
      expect(convState().streamingToolCalls).toEqual({})
    })

    it('dequeues a pending message so the queue is not stranded', () => {
      beginStreaming()
      setupHook()
      const sendMessage = useMessageStore.getState().sendMessage as Mock
      useMessageStore.setState((state) => {
        state.conversationStates[CONV].pendingMessages = [
          { content: 'queued', conversationId: CONV, provider: 'openai', model: 'gpt-4o' },
        ]
        return state
      })

      emit('chat-error', { conversation_id: CONV, error: 'boom' })

      expect(sendMessage.mock.calls[0]?.slice(0, 4)).toEqual(['queued', CONV, 'openai', 'gpt-4o'])
      expect(convState().pendingMessages).toEqual([])
    })
  })

  describe('chat-warning', () => {
    it('toasts when a vision-less model dropped input images', () => {
      setupHook()

      emit('chat-warning', { conversation_id: CONV, warning: 'model_no_vision', images: 2 })

      expect(toast.info).toHaveBeenCalledTimes(1)
    })

    it('stays silent when no images were dropped', () => {
      setupHook()

      emit('chat-warning', { conversation_id: CONV, warning: 'model_no_vision', images: 0 })
      emit('chat-warning', { conversation_id: CONV, warning: 'other_warning' })

      expect(toast.info).not.toHaveBeenCalled()
    })
  })

  describe('generation-stopped', () => {
    it('clears spinners and pending decisions but keeps streamed content', () => {
      beginStreaming()
      setupHook()
      useMessageStore.getState().setStreamingContent(CONV, 'partial')
      useMessageStore.getState().setPendingSearchDecision(CONV, 'msg-9', true)
      useMessageStore.getState().setIsReasoningActive(CONV, true)

      emit('generation-stopped', { conversation_id: CONV })

      const state = convState()
      expect(state.isStreaming).toBe(false)
      expect(state.isWaitingForAI).toBe(false)
      expect(state.isReasoningActive).toBe(false)
      expect(state.pendingSearchDecisions).toEqual({})
      // Streamed content stays visible until chat-complete saves the message
      expect(state.streamingContent).toBe('partial')
    })
  })

  describe('conversation-updated', () => {
    it('retitles the conversation in the list and when current', () => {
      const conv = { id: CONV, title: 'Old', created_at: '2026-01-01', updated_at: '2026-01-01' }
      const other = {
        id: 'conv-2',
        title: 'Other',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      }
      useConversationStore.setState({
        conversations: [conv, other],
        currentConversation: conv,
      })
      setupHook()

      emit('conversation-updated', { conversation_id: CONV, title: 'New title' })

      const state = useConversationStore.getState()
      expect(state.conversations.map((c) => c.title)).toEqual(['New title', 'Other'])
      expect(state.currentConversation?.title).toBe('New title')
    })

    it('leaves the current conversation untouched when another one is retitled', () => {
      const conv = { id: CONV, title: 'Mine', created_at: '2026-01-01', updated_at: '2026-01-01' }
      const other = {
        id: 'conv-2',
        title: 'Other',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      }
      useConversationStore.setState({
        conversations: [conv, other],
        currentConversation: conv,
      })
      setupHook()

      emit('conversation-updated', { conversation_id: 'conv-2', title: 'Retitled' })

      const state = useConversationStore.getState()
      expect(state.conversations.map((c) => c.title)).toEqual(['Mine', 'Retitled'])
      expect(state.currentConversation?.title).toBe('Mine')
    })
  })

  describe('attachment events', () => {
    it('marks urls fetching while processing', () => {
      setupHook()

      emit('attachment-processing-started', {
        conversation_id: CONV,
        message_id: 'msg-1',
        urls: ['https://a.example', 'https://b.example'],
      })

      const state = convState()
      expect(state.attachmentStatus).toBe('processing')
      expect(state.urlStatuses['msg-1']).toEqual({
        'https://a.example': 'fetching',
        'https://b.example': 'fetching',
      })
    })

    it('marks a single url fetched and refreshes on attachment-update', () => {
      setupHook()
      useMessageStore.getState().setUrlStatuses(CONV, 'msg-1', ['https://a.example'])
      useMessageStore.getState().setPendingSearchDecision(CONV, 'msg-1', true)

      emit('attachment-update', {
        conversation_id: CONV,
        message_id: 'msg-1',
        completed_url: 'https://a.example',
      })

      const state = convState()
      expect(state.urlStatuses['msg-1']['https://a.example']).toBe('fetched')
      expect(state.attachmentRefreshKey).toBe(1)
      expect(state.pendingSearchDecisions['msg-1']).toBeUndefined()
    })

    it('only bumps the refresh key when the update carries no url', () => {
      setupHook()

      emit('attachment-update', { conversation_id: CONV })

      expect(convState().attachmentRefreshKey).toBe(1)
      expect(convState().urlStatuses).toEqual({})
    })

    it('clears url statuses and completes on attachment-processing-complete', () => {
      setupHook()
      useMessageStore.getState().setUrlStatuses(CONV, 'msg-1', ['https://a.example'])
      useMessageStore.getState().setAttachmentStatus(CONV, 'processing')

      emit('attachment-processing-complete', { conversation_id: CONV, message_id: 'msg-1' })

      const state = convState()
      expect(state.attachmentStatus).toBe('complete')
      expect(state.urlStatuses).toEqual({})
    })

    it('flags the attachment status as error', () => {
      setupHook()

      emit('attachment-processing-error', {
        conversation_id: CONV,
        message_id: 'msg-1',
        error: 'fetch failed',
      })

      expect(convState().attachmentStatus).toBe('error')
    })
  })

  describe('search decision events', () => {
    it('marks the message pending while the decision runs', () => {
      setupHook()

      emit('search-decision-started', { conversation_id: CONV, message_id: 'msg-1' })

      expect(convState().pendingSearchDecisions['msg-1']).toBe(true)
    })

    it('refreshes on completion but leaves the pending flag for resource loading', () => {
      setupHook()
      useMessageStore.getState().setPendingSearchDecision(CONV, 'msg-1', true)

      emit('search-decision-complete', { conversation_id: CONV, message_id: 'msg-1' })

      const state = convState()
      expect(state.attachmentRefreshKey).toBe(1)
      // Deliberate: the pending flag clears once the decision step loads
      expect(state.pendingSearchDecisions['msg-1']).toBe(true)
    })
  })

  describe('mcp-auth-required', () => {
    it('probes the server for a fresh OAuth redirect', () => {
      setupHook()
      const probeEndpoint = useMcpStore.getState().probeEndpoint as Mock

      emit('mcp-auth-required', { conversation_id: CONV, server_id: 'server-1' })

      expect(probeEndpoint).toHaveBeenCalledWith('server-1')
    })
  })
})
