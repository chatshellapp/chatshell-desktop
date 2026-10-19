import { invoke } from '@tauri-apps/api/core'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMessageStore, createDefaultConversationState } from '../message'
import type { ConversationState } from '../message'
import { logger } from '@/lib/logger'
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

// crudActions dynamically imports the conversation store to bump the sidebar
const conversationMocks = vi.hoisted(() => ({
  bumpConversation: vi.fn(),
}))

vi.mock('../conversation', () => ({
  useConversationStore: {
    getState: () => ({ bumpConversation: conversationMocks.bumpConversation }),
  },
}))

const invokeMock = vi.mocked(invoke)

const createMockMessage = (id: string, content: string, sender_type: string = 'user'): Message => ({
  id,
  conversation_id: 'conv-1',
  sender_type,
  content,
  created_at: '2024-01-01T00:00:00Z',
})

const page = (count: number, prefix: string, startTs = 0) =>
  Array.from({ length: count }, (_, i) => ({
    ...createMockMessage(`${prefix}${i}`, `content ${prefix}${i}`),
    created_at: new Date(2026, 0, 1, 0, 0, startTs + i).toISOString(),
  }))

const patchConv = (id: string, patch: Partial<ConversationState>) => {
  useMessageStore.setState((s) => ({
    conversationStates: {
      ...s.conversationStates,
      [id]: { ...(s.conversationStates[id] ?? createDefaultConversationState()), ...patch },
    },
  }))
}

describe('message store crudActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to initial values
    useMessageStore.setState({
      conversationStates: {},
      isSending: false,
      error: null,
      onNewConversationCreated: undefined,
    })
  })

  describe('sendMessage', () => {
    it('sends through an existing conversation, resets streaming leftovers and waits for the assistant', async () => {
      useMessageStore.setState({
        conversationStates: {
          'conv-1': {
            ...createDefaultConversationState(),
            apiError: 'previous failure',
            streamingContent: 'leftover',
            streamingReasoningContent: 'leftover reasoning',
            streamingToolCalls: {
              tool1: {
                id: 'tool1',
                tool_name: 'search',
                tool_input: '{}',
                status: 'running',
                order: 0,
              },
            },
          },
        },
      })
      const userMessage = createMockMessage('msg-u', 'hello')
      let resolveSend!: (value: Message) => void
      invokeMock.mockImplementation(
        () => new Promise<Message>((resolve) => (resolveSend = resolve))
      )

      const pending = useMessageStore.getState().sendMessage('hello', 'conv-1', 'openai', 'gpt-4')
      // Sending flag flips on synchronously before the backend call resolves
      expect(useMessageStore.getState().isSending).toBe(true)

      resolveSend(userMessage)
      await pending

      const state = useMessageStore.getState()
      expect(state.isSending).toBe(false)
      expect(state.error).toBeNull()
      const cs = state.getConversationState('conv-1')
      expect(cs.messages).toHaveLength(1)
      expect(cs.messages[0]).toEqual(userMessage)
      expect(cs.apiError).toBeNull()
      expect(cs.streamingContent).toBe('')
      expect(cs.streamingReasoningContent).toBe('')
      expect(cs.streamingToolCalls).toEqual({})
      // Still waiting for the assistant message delivered via the chat-complete event
      expect(cs.isStreaming).toBe(true)
      expect(cs.isWaitingForAI).toBe(true)
      expect(conversationMocks.bumpConversation).toHaveBeenCalledWith('conv-1', 'hello')

      const [cmd, args] = invokeMock.mock.calls[0]
      expect(cmd).toBe('send_message')
      expect(args).toMatchObject({
        conversationId: 'conv-1',
        content: 'hello',
        provider: 'openai',
        model: 'gpt-4',
      })
    })

    it('passes every optional parameter through to the backend command', async () => {
      invokeMock.mockResolvedValue(createMockMessage('msg-full', 'with extras'))

      await useMessageStore
        .getState()
        .sendMessage(
          'with extras',
          'conv-1',
          'openai',
          'gpt-4o',
          'sk-test',
          'https://example.com/v1',
          'openai',
          true,
          'sys prompt',
          'usr prompt',
          'model-7',
          'assistant-3',
          ['https://example.com/page'],
          [{ name: 'pic.png', base64: 'aGk=', mimeType: 'image/png' }],
          [{ name: 'doc.txt', content: 'hello file', mimeType: 'text/plain' }],
          true,
          { temperature: 0.7, max_tokens: 512 },
          10,
          false,
          ['res-1', 'res-2']
        )

      expect(invokeMock).toHaveBeenCalledWith('send_message', {
        conversationId: 'conv-1',
        content: 'with extras',
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
        baseUrl: 'https://example.com/v1',
        apiStyle: 'openai',
        includeHistory: true,
        systemPrompt: 'sys prompt',
        userPrompt: 'usr prompt',
        modelDbId: 'model-7',
        assistantDbId: 'assistant-3',
        urlsToFetch: ['https://example.com/page'],
        images: [{ name: 'pic.png', base64: 'aGk=', mimeType: 'image/png' }],
        files: [{ name: 'doc.txt', content: 'hello file', mimeType: 'text/plain' }],
        searchEnabled: true,
        parameterOverrides: { temperature: 0.7, max_tokens: 512 },
        contextMessageCount: 10,
        useProviderDefaults: false,
        reuseFetchResultIds: ['res-1', 'res-2'],
      })
    })

    it('creates a conversation first when none exists and notifies the listener', async () => {
      const onCreated = vi.fn()
      useMessageStore.setState({ onNewConversationCreated: onCreated })
      const newConversation = {
        id: 'conv-new',
        title: '',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }
      const userMessage = { ...createMockMessage('msg-new', 'hi'), conversation_id: 'conv-new' }
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === 'create_conversation') return newConversation
        return userMessage
      })

      await useMessageStore.getState().sendMessage('hi', null, 'openai', 'gpt-4')

      expect(invokeMock).toHaveBeenCalledWith('create_conversation', { req: { title: '' } })
      expect(onCreated).toHaveBeenCalledTimes(1)
      expect(onCreated).toHaveBeenCalledWith(newConversation)
      expect(conversationMocks.bumpConversation).toHaveBeenCalledWith('conv-new', 'hi')

      const cs = useMessageStore.getState().getConversationState('conv-new')
      expect(cs.messages).toHaveLength(1)
      expect(cs.messages[0].id).toBe('msg-new')
      expect(useMessageStore.getState().isSending).toBe(false)
    })

    it('records the error, stops sending and rethrows when send_message fails', async () => {
      invokeMock.mockRejectedValue(new Error('send failed'))

      await expect(
        useMessageStore.getState().sendMessage('hi', 'conv-1', 'openai', 'gpt-4')
      ).rejects.toThrow('send failed')

      const state = useMessageStore.getState()
      expect(state.error).toBe('Error: send failed')
      expect(state.isSending).toBe(false)
    })

    it('rethrows when creating a new conversation fails before sending', async () => {
      invokeMock.mockRejectedValueOnce(new Error('create failed'))

      await expect(
        useMessageStore.getState().sendMessage('hi', null, 'openai', 'gpt-4')
      ).rejects.toThrow('create failed')

      const state = useMessageStore.getState()
      expect(state.error).toBe('Error: create failed')
      expect(state.isSending).toBe(false)
      expect(conversationMocks.bumpConversation).not.toHaveBeenCalled()
    })
  })

  describe('stopGeneration', () => {
    it('asks the backend to stop and resets the sending flag', async () => {
      useMessageStore.setState({ isSending: true })
      invokeMock.mockResolvedValue(undefined)

      await useMessageStore.getState().stopGeneration('conv-1')

      expect(invokeMock).toHaveBeenCalledWith('stop_generation', { conversationId: 'conv-1' })
      expect(useMessageStore.getState().isSending).toBe(false)
    })

    it('swallows backend errors without resetting the sending flag', async () => {
      useMessageStore.setState({ isSending: true })
      invokeMock.mockRejectedValue(new Error('stop refused'))

      await expect(useMessageStore.getState().stopGeneration('conv-1')).resolves.toBeUndefined()

      expect(useMessageStore.getState().isSending).toBe(true)
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        '[messageStore] Failed to stop generation:',
        expect.any(Error)
      )
    })
  })

  describe('clearMessages', () => {
    it('empties the window after the backend clears history', async () => {
      const store = useMessageStore.getState()
      store.addMessage('conv-1', createMockMessage('m1', 'one'))
      store.addMessage('conv-1', createMockMessage('m2', 'two'))
      invokeMock.mockResolvedValue(undefined)

      await store.clearMessages('conv-1')

      expect(invokeMock).toHaveBeenCalledWith('clear_messages_by_conversation', {
        conversationId: 'conv-1',
      })
      const cs = useMessageStore.getState().getConversationState('conv-1')
      expect(cs.messages).toHaveLength(0)
      expect(cs.isLoading).toBe(false)
    })

    it('rethrows and records the error when clearing fails', async () => {
      useMessageStore.getState().getConversationState('conv-1')
      invokeMock.mockRejectedValue(new Error('clear failed'))

      await expect(useMessageStore.getState().clearMessages('conv-1')).rejects.toThrow(
        'clear failed'
      )

      const state = useMessageStore.getState()
      expect(state.error).toBe('Error: clear failed')
      expect(state.getConversationState('conv-1').isLoading).toBe(false)
    })
  })

  describe('deleteMessagesFrom', () => {
    it('removes the message and everything after it', async () => {
      const store = useMessageStore.getState()
      store.addMessage('conv-1', createMockMessage('m1', 'one'))
      store.addMessage('conv-1', createMockMessage('m2', 'two'))
      store.addMessage('conv-1', createMockMessage('m3', 'three'))
      store.addMessage('conv-1', createMockMessage('m4', 'four'))
      invokeMock.mockResolvedValue(undefined)

      await store.deleteMessagesFrom('conv-1', 'm3')

      expect(invokeMock).toHaveBeenCalledWith('delete_messages_from', {
        conversationId: 'conv-1',
        messageId: 'm3',
      })
      expect(
        useMessageStore
          .getState()
          .getConversationState('conv-1')
          .messages.map((m) => m.id)
      ).toEqual(['m1', 'm2'])
    })

    it('keeps the window when the message is not loaded', async () => {
      useMessageStore.getState().addMessage('conv-1', createMockMessage('m1', 'one'))
      invokeMock.mockResolvedValue(undefined)

      await useMessageStore.getState().deleteMessagesFrom('conv-1', 'missing')

      expect(
        useMessageStore
          .getState()
          .getConversationState('conv-1')
          .messages.map((m) => m.id)
      ).toEqual(['m1'])
    })

    it('rethrows when the backend delete fails', async () => {
      useMessageStore.getState().getConversationState('conv-1')
      invokeMock.mockRejectedValue(new Error('delete failed'))

      await expect(useMessageStore.getState().deleteMessagesFrom('conv-1', 'm1')).rejects.toThrow(
        'delete failed'
      )

      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        '[messageStore] Failed to delete messages from:',
        expect.any(Error)
      )
    })
  })

  describe('addMessage idempotency', () => {
    it('replaces an existing message in place instead of duplicating it', () => {
      const store = useMessageStore.getState()
      store.addMessage('conv-1', createMockMessage('m1', 'one'))
      store.addMessage('conv-1', createMockMessage('m2', 'two'))
      store.addMessage('conv-1', createMockMessage('m2', 'two (edited)'))

      const cs = useMessageStore.getState().getConversationState('conv-1')
      expect(cs.messages).toHaveLength(2)
      expect(cs.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
      expect(cs.messages[1].content).toBe('two (edited)')
    })

    it('clears the waiting flag once the message lands', () => {
      patchConv('conv-1', { isWaitingForAI: true })

      useMessageStore.getState().addMessage('conv-1', createMockMessage('m-a', 'done', 'assistant'))

      expect(useMessageStore.getState().getConversationState('conv-1').isWaitingForAI).toBe(false)
    })
  })

  describe('pending message queue', () => {
    const queued = (content: string) => ({
      content,
      conversationId: 'conv-q',
      provider: 'openai',
      model: 'gpt-4',
    })

    it('enqueueMessage appends messages in order', () => {
      const store = useMessageStore.getState()
      store.enqueueMessage('conv-q', queued('first'))
      store.enqueueMessage('conv-q', queued('second'))

      const cs = useMessageStore.getState().getConversationState('conv-q')
      expect(cs.pendingMessages.map((m) => m.content)).toEqual(['first', 'second'])
    })

    it('removePendingMessage drops only valid indices', () => {
      const store = useMessageStore.getState()
      store.enqueueMessage('conv-q', queued('first'))
      store.enqueueMessage('conv-q', queued('second'))
      store.enqueueMessage('conv-q', queued('third'))

      store.removePendingMessage('conv-q', 9)
      store.removePendingMessage('conv-q', -1)
      expect(
        useMessageStore.getState().getConversationState('conv-q').pendingMessages
      ).toHaveLength(3)

      store.removePendingMessage('conv-q', 1)
      expect(
        useMessageStore
          .getState()
          .getConversationState('conv-q')
          .pendingMessages.map((m) => m.content)
      ).toEqual(['first', 'third'])
    })

    it('clearPendingMessages empties the queue', () => {
      const store = useMessageStore.getState()
      store.enqueueMessage('conv-q', queued('first'))
      store.enqueueMessage('conv-q', queued('second'))

      store.clearPendingMessages('conv-q')

      expect(
        useMessageStore.getState().getConversationState('conv-q').pendingMessages
      ).toHaveLength(0)
    })

    it('processNextPendingMessage is a no-op when the queue is empty', () => {
      useMessageStore.getState().getConversationState('conv-q')

      useMessageStore.getState().processNextPendingMessage('conv-q')

      expect(invokeMock).not.toHaveBeenCalled()
      expect(
        useMessageStore.getState().getConversationState('conv-q').pendingMessages
      ).toHaveLength(0)
    })

    it('processNextPendingMessage dequeues and dispatches via sendMessage', async () => {
      useMessageStore.getState().enqueueMessage('conv-q', {
        content: 'queued hello',
        conversationId: 'conv-q',
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-queue',
        searchEnabled: true,
        parameterOverrides: { temperature: 0.5 },
      })
      invokeMock.mockResolvedValue({
        ...createMockMessage('msg-q', 'queued hello'),
        conversation_id: 'conv-q',
      })

      useMessageStore.getState().processNextPendingMessage('conv-q')

      await vi.waitFor(() => {
        expect(useMessageStore.getState().getConversationState('conv-q').messages).toHaveLength(1)
      })
      const cs = useMessageStore.getState().getConversationState('conv-q')
      expect(cs.pendingMessages).toHaveLength(0)
      expect(cs.messages[0].id).toBe('msg-q')
      expect(invokeMock).toHaveBeenCalledWith(
        'send_message',
        expect.objectContaining({
          conversationId: 'conv-q',
          content: 'queued hello',
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: 'sk-queue',
          searchEnabled: true,
          parameterOverrides: { temperature: 0.5 },
        })
      )
      expect(conversationMocks.bumpConversation).toHaveBeenCalledWith('conv-q', 'queued hello')
      expect(useMessageStore.getState().isSending).toBe(false)
    })
  })

  describe('window pagination error paths', () => {
    it('loadMessages records the error and stops loading when the query fails', async () => {
      invokeMock.mockRejectedValue(new Error('db down'))

      await useMessageStore.getState().loadMessages('conv-e')

      const state = useMessageStore.getState()
      expect(state.error).toBe('Error: db down')
      const cs = state.getConversationState('conv-e')
      expect(cs.isLoading).toBe(false)
      expect(cs.messages).toHaveLength(0)
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Failed to load messages:',
        expect.any(Error)
      )
    })

    it('loadOlderMessages reports failure without breaking the window', async () => {
      invokeMock.mockResolvedValueOnce(page(101, 'm'))
      await useMessageStore.getState().loadMessages('conv-p')
      invokeMock.mockRejectedValueOnce(new Error('older query failed'))

      const loaded = await useMessageStore.getState().loadOlderMessages('conv-p')

      const cs = useMessageStore.getState().getConversationState('conv-p')
      expect(loaded).toBe(false)
      expect(cs.isLoadingOlder).toBe(false)
      expect(cs.messages).toHaveLength(100)
      expect(cs.hasOlderMessages).toBe(true)
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Failed to load older messages:',
        expect.any(Error)
      )
    })

    it('loadOlderMessages bails out when the window is empty even if older history is flagged', async () => {
      useMessageStore.setState({
        conversationStates: {
          'conv-e': { ...createDefaultConversationState(), hasOlderMessages: true },
        },
      })

      const loaded = await useMessageStore.getState().loadOlderMessages('conv-e')

      expect(loaded).toBe(false)
      expect(invokeMock).not.toHaveBeenCalled()
    })

    it('loadAllMessages waits for an in-flight page instead of treating it as exhausted', async () => {
      invokeMock.mockResolvedValueOnce(page(101, 'm'))
      await useMessageStore.getState().loadMessages('conv-p')

      // Simulate a scroll-triggered page already in flight
      patchConv('conv-p', { isLoadingOlder: true })
      invokeMock.mockResolvedValueOnce(page(50, 'old'))

      const allLoaded = useMessageStore.getState().loadAllMessages('conv-p')
      // Release the in-flight flag while loadAllMessages waits on its timer
      patchConv('conv-p', { isLoadingOlder: false })
      await allLoaded

      const cs = useMessageStore.getState().getConversationState('conv-p')
      expect(cs.messages).toHaveLength(150)
      expect(cs.messages[0].id).toBe('old0')
      expect(cs.hasOlderMessages).toBe(false)
      expect(cs.isLoadingOlder).toBe(false)
      // Initial window plus exactly one waited-for older page
      expect(invokeMock).toHaveBeenCalledTimes(2)
    })
  })
})
