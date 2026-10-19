import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useState } from 'react'
import { toast } from 'sonner'
import i18n from '@/lib/i18n'
import { useSubmitHandler } from '../useSubmitHandler'
import { useConversationStore } from '@/stores/conversation'
import { useMessageStore } from '@/stores/message'
import { useModelStore } from '@/stores/modelStore'
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { usePromptStore } from '@/stores/promptStore'
import { useInputHistoryStore } from '@/stores/inputHistoryStore'
import { createDefaultConversationSettings } from '@/types'
import type { Attachment } from '../types'
import type { Assistant, Conversation, Model, Prompt, Provider } from '@/types'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// Initialize i18n so useTranslation('messages') resolves real copy
void i18n

const CONV = 'conv-1'
const NOW = '2026-01-01T00:00:00Z'

const conversation: Conversation = {
  id: CONV,
  title: 'Test',
  created_at: NOW,
  updated_at: NOW,
}

const model: Model = {
  id: 'model-1',
  provider_id: 'provider-1',
  name: 'GPT-4o',
  model_id: 'gpt-4o',
  is_starred: false,
  is_deleted: false,
  created_at: NOW,
  updated_at: NOW,
}

const provider: Provider = {
  id: 'provider-1',
  name: 'OpenAI',
  provider_type: 'openai',
  api_key: 'sk-test',
  base_url: 'https://api.example.com',
  api_style: 'responses',
  is_enabled: true,
  created_at: NOW,
  updated_at: NOW,
}

const assistant: Assistant = {
  id: 'assistant-1',
  name: 'Helper',
  model_id: 'model-1',
  system_prompt: 'assistant system prompt',
  user_prompt: 'assistant user prompt',
  tool_ids: [],
  skill_ids: [],
  avatar_type: 'text',
  is_starred: false,
  created_at: NOW,
  updated_at: NOW,
}

const prompt: Prompt = {
  id: 'prompt-1',
  name: 'Existing prompt',
  content: 'existing prompt content',
  is_system: false,
  is_starred: false,
  created_at: NOW,
  updated_at: NOW,
}

let attachmentsCleared = false

function SendHarness({
  initialInput = '',
  attachments = [],
  webSearchEnabled = false,
}: {
  initialInput?: string
  attachments?: Attachment[]
  webSearchEnabled?: boolean
}) {
  const [input, setInput] = useState(initialInput)
  const { handleSend, handleStop } = useSubmitHandler({
    input,
    setInput,
    attachments,
    clearAttachments: () => {
      attachmentsCleared = true
    },
    webSearchEnabled,
  })
  return (
    <>
      <input data-testid="input-field" value={input} onChange={(e) => setInput(e.target.value)} />
      <button data-testid="send" onClick={() => void handleSend()}>
        send
      </button>
      <button data-testid="stop" onClick={() => void handleStop()}>
        stop
      </button>
    </>
  )
}

function setup({
  input = 'Hello',
  attachments = [],
  webSearchEnabled = false,
}: { input?: string; attachments?: Attachment[]; webSearchEnabled?: boolean } = {}) {
  // The hook reads the conversation state through a selector at render time;
  // pre-create it so the first render never triggers a store write
  useMessageStore.getState().getConversationState(CONV)
  render(
    <SendHarness
      initialInput={input}
      attachments={attachments}
      webSearchEnabled={webSearchEnabled}
    />
  )
}

function click(testId: 'send' | 'stop') {
  fireEvent.click(screen.getByTestId(testId))
}

describe('useSubmitHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    attachmentsCleared = false
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
      pendingInput: null,
    })
    useModelStore.setState({ models: [], providers: [], isLoading: false, error: null })
    usePromptStore.setState({ prompts: [], isLoading: false, error: null })
    useConversationSettingsStore.setState({ settings: {}, loading: {}, error: null })
    useInputHistoryStore.setState({ history: [], isLoaded: false, addEntry: vi.fn() })
    useMessageStore.setState({
      conversationStates: {},
      isSending: false,
      error: null,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      enqueueMessage: vi.fn(),
      stopGeneration: vi.fn().mockResolvedValue(undefined),
    })
  })

  const sendMessage = () => useMessageStore.getState().sendMessage as Mock
  const enqueueMessage = () => useMessageStore.getState().enqueueMessage as Mock
  const stopGeneration = () => useMessageStore.getState().stopGeneration as Mock
  const addHistoryEntry = () => useInputHistoryStore.getState().addEntry as Mock

  describe('handleSend validation', () => {
    it('refuses to send blank input', async () => {
      useConversationStore.setState({ currentConversation: conversation, selectedModel: model })
      useModelStore.setState({ models: [model], providers: [provider] })
      setup({ input: '   ' })
      click('send')

      await waitFor(() => expect(screen.getByTestId('input-field')).toHaveValue('   '))
      expect(sendMessage()).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('blocks sending when neither model nor assistant is selected', async () => {
      useConversationStore.setState({ currentConversation: conversation })
      setup()
      click('send')

      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
      expect(sendMessage()).not.toHaveBeenCalled()
      expect(screen.getByTestId('input-field')).toHaveValue('Hello')
    })

    it('blocks sending when the assistant model is no longer known', async () => {
      useConversationStore.setState({
        currentConversation: conversation,
        selectedAssistant: assistant,
      })
      useModelStore.setState({ models: [], providers: [provider] })
      setup()
      click('send')

      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
      expect(sendMessage()).not.toHaveBeenCalled()
    })

    it('blocks sending when the provider of the model is missing', async () => {
      useConversationStore.setState({ currentConversation: conversation, selectedModel: model })
      useModelStore.setState({ models: [model], providers: [] })
      setup()
      click('send')

      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
      expect(sendMessage()).not.toHaveBeenCalled()
    })
  })

  describe('handleSend with a selected model', () => {
    beforeEach(() => {
      useConversationStore.setState({ currentConversation: conversation, selectedModel: model })
      useModelStore.setState({ models: [model], providers: [provider] })
    })

    it('sends the message with resolved provider credentials', async () => {
      setup()
      click('send')

      await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1))
      expect(sendMessage()).toHaveBeenCalledWith(
        'Hello',
        CONV,
        'openai',
        'gpt-4o',
        'sk-test',
        'https://api.example.com',
        'responses',
        undefined,
        undefined,
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
      // Input clears, history records the sent text, attachments reset
      await waitFor(() => expect(screen.getByTestId('input-field')).toHaveValue(''))
      expect(addHistoryEntry()).toHaveBeenCalledWith('Hello')
      expect(attachmentsCleared).toBe(true)
    })

    it('forwards the web-search toggle and webpage attachments as urls to fetch', async () => {
      setup({
        input: 'search this',
        webSearchEnabled: true,
        attachments: [
          { id: 'w1', type: 'webpage', name: 'https://example.com/page' },
          { id: 'w2', type: 'webpage', name: 'https://other.example' },
        ],
      })
      click('send')

      await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1))
      const call = sendMessage().mock.calls[0]
      expect(call?.slice(0, 4)).toEqual(['search this', CONV, 'openai', 'gpt-4o'])
      expect(call?.[12]).toEqual(['https://example.com/page', 'https://other.example'])
      expect(call?.[15]).toBe(true)
    })

    it('only forwards file attachments that carry content or base64', async () => {
      setup({
        attachments: [
          {
            id: 'f1',
            type: 'file',
            name: 'notes.txt',
            content: 'plain text',
            mimeType: 'text/plain',
          },
          { id: 'f2', type: 'file', name: 'empty.pdf', mimeType: 'application/pdf' },
          {
            id: 'i1',
            type: 'image',
            name: 'shot.png',
            base64: 'data:image/png;base64,AAA=',
            mimeType: 'image/png',
          },
        ],
      })
      click('send')

      await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1))
      const call = sendMessage().mock.calls[0]
      // The pdf without extracted content is dropped, not sent half-empty
      expect(call?.[13]).toEqual([
        { name: 'shot.png', base64: 'data:image/png;base64,AAA=', mimeType: 'image/png' },
      ])
      expect(call?.[14]).toEqual([
        { name: 'notes.txt', content: 'plain text', base64: undefined, mimeType: 'text/plain' },
      ])
    })
  })

  describe('handleSend with a selected assistant', () => {
    beforeEach(() => {
      useConversationStore.setState({
        currentConversation: conversation,
        selectedAssistant: assistant,
      })
      useModelStore.setState({ models: [model], providers: [provider] })
    })

    it('resolves the model, ids and prompts from the assistant', async () => {
      setup()
      click('send')

      await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1))
      const call = sendMessage().mock.calls[0]
      expect(call?.slice(0, 4)).toEqual(['Hello', CONV, 'openai', 'gpt-4o'])
      expect(call?.[8]).toBe('assistant system prompt')
      expect(call?.[10]).toBeUndefined() // modelDbId
      expect(call?.[11]).toBe('assistant-1')
    })

    it('uses the assistant user prompt when the conversation has none configured', async () => {
      useConversationSettingsStore.setState({
        settings: { [CONV]: createDefaultConversationSettings(CONV) },
      })
      setup()
      click('send')

      await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1))
      expect(sendMessage().mock.calls[0]?.[9]).toBe('assistant user prompt')
    })
  })

  describe('handleSend with conversation settings', () => {
    beforeEach(() => {
      useConversationStore.setState({ currentConversation: conversation, selectedModel: model })
      useModelStore.setState({ models: [model], providers: [provider] })
    })

    it('prefers the existing prompt selected in settings over the assistant prompt', async () => {
      usePromptStore.setState({ prompts: [prompt] })
      useConversationSettingsStore.setState({
        settings: {
          [CONV]: {
            ...createDefaultConversationSettings(CONV),
            systemPromptMode: 'existing',
            selectedSystemPromptId: 'prompt-1',
          },
        },
      })
      setup()
      click('send')

      await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1))
      expect(sendMessage().mock.calls[0]?.[8]).toBe('existing prompt content')
    })

    it('uses the custom system prompt content when mode is custom', async () => {
      useConversationSettingsStore.setState({
        settings: {
          [CONV]: {
            ...createDefaultConversationSettings(CONV),
            systemPromptMode: 'custom',
            customSystemPrompt: 'custom override',
          },
        },
      })
      setup()
      click('send')

      await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1))
      expect(sendMessage().mock.calls[0]?.[8]).toBe('custom override')
    })

    it('sends no system prompt when the selected prompt id is unknown', async () => {
      useConversationSettingsStore.setState({
        settings: {
          [CONV]: {
            ...createDefaultConversationSettings(CONV),
            systemPromptMode: 'existing',
            selectedSystemPromptId: 'missing-prompt',
          },
        },
      })
      setup()
      click('send')

      await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1))
      expect(sendMessage().mock.calls[0]?.[8]).toBeUndefined()
    })

    it('forwards custom parameter overrides and context window settings', async () => {
      useConversationSettingsStore.setState({
        settings: {
          [CONV]: {
            ...createDefaultConversationSettings(CONV),
            useProviderDefaults: false,
            useCustomParameters: true,
            parameterOverrides: { temperature: 0.2 },
            contextMessageCount: 10,
          },
        },
      })
      setup()
      click('send')

      await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1))
      const call = sendMessage().mock.calls[0]
      expect(call?.[16]).toEqual({ temperature: 0.2 })
      expect(call?.[17]).toBe(10)
      expect(call?.[18]).toBe(false)
    })
  })

  describe('handleSend while a response is streaming', () => {
    it('queues the message instead of sending immediately', async () => {
      useConversationStore.setState({ currentConversation: conversation, selectedModel: model })
      useModelStore.setState({ models: [model], providers: [provider] })
      setup()
      act(() => {
        useMessageStore.setState((state) => {
          state.conversationStates[CONV].isStreaming = true
          return state
        })
      })
      click('send')

      await waitFor(() => expect(enqueueMessage()).toHaveBeenCalledTimes(1))
      expect(sendMessage()).not.toHaveBeenCalled()
      expect(enqueueMessage()).toHaveBeenCalledWith(
        CONV,
        expect.objectContaining({
          content: 'Hello',
          conversationId: CONV,
          provider: 'openai',
          model: 'gpt-4o',
          modelDbId: 'model-1',
        })
      )
      await waitFor(() => expect(screen.getByTestId('input-field')).toHaveValue(''))
    })
  })

  describe('handleSend failure', () => {
    it('toasts the error and keeps the input cleared', async () => {
      useConversationStore.setState({ currentConversation: conversation, selectedModel: model })
      useModelStore.setState({ models: [model], providers: [provider] })
      useMessageStore.setState({
        sendMessage: vi.fn().mockRejectedValue(new Error('network down')),
      })
      setup()
      click('send')

      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
      expect(screen.getByTestId('input-field')).toHaveValue('')
      expect(addHistoryEntry()).not.toHaveBeenCalled()
    })
  })

  describe('handleStop', () => {
    it('does nothing without a current conversation', async () => {
      setup()
      click('stop')

      await waitFor(() => expect(stopGeneration()).not.toHaveBeenCalled())
    })

    it('stops generation for the current conversation', async () => {
      useConversationStore.setState({ currentConversation: conversation })
      setup()
      click('stop')

      await waitFor(() => expect(stopGeneration()).toHaveBeenCalledWith(CONV))
    })

    it('swallows stop failures without toasting', async () => {
      useConversationStore.setState({ currentConversation: conversation })
      useMessageStore.setState({
        stopGeneration: vi.fn().mockRejectedValue(new Error('no active task')),
      })
      setup()
      click('stop')

      await waitFor(() => expect(stopGeneration()).toHaveBeenCalledTimes(1))
      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
