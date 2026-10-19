import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTranslationStore, initializeTranslationModel, LANGUAGES } from '../translationStore'
import { logger } from '@/lib/logger'
import type { Model, Provider } from '@/types'

const { listenHandlers, unlistenSpies, modelStoreState, selectConversation, setSystemPrompt } =
  vi.hoisted(() => ({
    listenHandlers: new Map<string, (event: { payload: unknown }) => void>(),
    unlistenSpies: [] as Array<() => void>,
    modelStoreState: {
      models: [] as Array<Model>,
      providers: [] as Array<Provider>,
    },
    selectConversation: vi.fn(),
    setSystemPrompt: vi.fn(),
  }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    listenHandlers.set(event, handler)
    const unlisten = vi.fn()
    unlistenSpies.push(unlisten)
    return unlisten
  }),
  emit: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/i18n', () => ({
  default: { t: (key: string) => `t:${key}` },
  getCurrentLanguage: () => 'en',
}))

vi.mock('../modelStore', () => ({
  useModelStore: { getState: () => modelStoreState },
}))

vi.mock('../conversation', () => ({
  useConversationStore: { getState: () => ({ selectConversation }) },
}))

vi.mock('../conversationSettingsStore', () => ({
  useConversationSettingsStore: { getState: () => ({ setSystemPrompt }) },
}))

const invokeMock = vi.mocked(invoke)
const listenMock = vi.mocked(listen)

const createMockModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'model-1',
  name: 'Test Model',
  provider_id: 'provider-1',
  model_id: 'test-model-x',
  is_starred: false,
  is_deleted: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const createMockProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'provider-1',
  name: 'Test Provider',
  provider_type: 'openai',
  is_enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

// Shape of lastTranslationContext used to seed the store in continue tests
interface SeededTranslationContext {
  sourceLanguage: string
  targetLanguage: string
  inputText: string
  outputText: string
  selectedModel: Model
}

// Prepares model + provider + input text so translate() can run its main path
const setupTranslate = (providerOverrides: Partial<Provider> = {}) => {
  const model = createMockModel()
  const provider = createMockProvider(providerOverrides)
  modelStoreState.providers = [provider]
  const store = useTranslationStore.getState()
  store.setSelectedModel(model)
  store.setInputText('hello')
  return { model, provider }
}

const seedTranslationContext = (overrides: Partial<SeededTranslationContext> = {}) => {
  const model = createMockModel()
  useTranslationStore.setState({
    canContinue: true,
    lastTranslationContext: {
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      inputText: 'hello',
      outputText: 'こんにちは',
      selectedModel: model,
      ...overrides,
    },
  })
  return model
}

const fire = (event: string, payload: unknown) => {
  const handler = listenHandlers.get(event)
  if (!handler) throw new Error(`No handler registered for ${event}`)
  handler({ payload })
}

describe('useTranslationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'create_conversation') return { id: 'conv-1' }
      return undefined
    })
    localStorage.removeItem('translation_selected_model_id')
    listenHandlers.clear()
    unlistenSpies.length = 0
    modelStoreState.models = []
    modelStoreState.providers = []
    useTranslationStore.setState({
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      inputText: '',
      outputText: '',
      isTranslating: false,
      error: null,
      conversationId: null,
      selectedModel: null,
      unlistenFns: [],
      canContinue: false,
      lastTranslationContext: null,
    })
  })

  describe('initial state', () => {
    it('starts with defaults derived from the app language', () => {
      const state = useTranslationStore.getState()
      expect(state.sourceLanguage).toBe('auto')
      expect(state.targetLanguage).toBe('en')
      expect(state.inputText).toBe('')
      expect(state.outputText).toBe('')
      expect(state.isTranslating).toBe(false)
      expect(state.error).toBeNull()
      expect(state.conversationId).toBeNull()
      expect(state.selectedModel).toBeNull()
      expect(state.unlistenFns).toEqual([])
      expect(state.canContinue).toBe(false)
      expect(state.lastTranslationContext).toBeNull()
    })
  })

  describe('LANGUAGES', () => {
    it('includes auto detect and common languages', () => {
      const codes = LANGUAGES.map((l) => l.code)
      expect(codes).toContain('auto')
      expect(codes).toContain('en')
      expect(codes).toContain('ja')
    })
  })

  describe('simple setters', () => {
    it('setSourceLanguage updates the source language', () => {
      useTranslationStore.getState().setSourceLanguage('fr')
      expect(useTranslationStore.getState().sourceLanguage).toBe('fr')
    })

    it('setTargetLanguage updates the target language', () => {
      useTranslationStore.getState().setTargetLanguage('ja')
      expect(useTranslationStore.getState().targetLanguage).toBe('ja')
    })

    it('setInputText updates the input text', () => {
      useTranslationStore.getState().setInputText('bonjour')
      expect(useTranslationStore.getState().inputText).toBe('bonjour')
    })
  })

  describe('setSelectedModel', () => {
    it('stores the model and persists its id to localStorage', () => {
      useTranslationStore.getState().setSelectedModel(createMockModel())

      expect(useTranslationStore.getState().selectedModel?.id).toBe('model-1')
      expect(localStorage.getItem('translation_selected_model_id')).toBe('model-1')
    })

    it('clears the model and removes the persisted id when set to null', () => {
      useTranslationStore.getState().setSelectedModel(createMockModel())
      useTranslationStore.getState().setSelectedModel(null)

      expect(useTranslationStore.getState().selectedModel).toBeNull()
      expect(localStorage.getItem('translation_selected_model_id')).toBeNull()
    })
  })

  describe('swapLanguages', () => {
    it('does nothing while source language is auto', () => {
      useTranslationStore.setState({
        sourceLanguage: 'auto',
        targetLanguage: 'ja',
        inputText: 'hello',
        outputText: 'こんにちは',
      })

      useTranslationStore.getState().swapLanguages()

      const state = useTranslationStore.getState()
      expect(state.sourceLanguage).toBe('auto')
      expect(state.targetLanguage).toBe('ja')
      expect(state.inputText).toBe('hello')
      expect(state.outputText).toBe('こんにちは')
    })

    it('swaps languages and texts when source is a concrete language', () => {
      useTranslationStore.setState({
        sourceLanguage: 'en',
        targetLanguage: 'ja',
        inputText: 'hello',
        outputText: 'こんにちは',
      })

      useTranslationStore.getState().swapLanguages()

      const state = useTranslationStore.getState()
      expect(state.sourceLanguage).toBe('ja')
      expect(state.targetLanguage).toBe('en')
      expect(state.inputText).toBe('こんにちは')
      expect(state.outputText).toBe('hello')
    })
  })

  describe('translate', () => {
    it('returns early without invoking when input is blank', async () => {
      setupTranslate()
      useTranslationStore.getState().setInputText('   ')

      await useTranslationStore.getState().translate()

      expect(invokeMock).not.toHaveBeenCalled()
      expect(useTranslationStore.getState().isTranslating).toBe(false)
    })

    it('sets an error when no model is selected', async () => {
      useTranslationStore.getState().setInputText('hello')

      await useTranslationStore.getState().translate()

      const state = useTranslationStore.getState()
      expect(state.error).toBe('t:sidebar:selectModelError')
      expect(state.isTranslating).toBe(false)
      expect(invokeMock).not.toHaveBeenCalled()
    })

    it('sets an error when the provider of the model is not loaded', async () => {
      setupTranslate()
      modelStoreState.providers = []

      await useTranslationStore.getState().translate()

      const state = useTranslationStore.getState()
      expect(state.error).toBe('t:sidebar:providerNotFound')
      expect(state.isTranslating).toBe(false)
      expect(invokeMock).not.toHaveBeenCalled()
    })

    it('creates a temp conversation, registers listeners and sends the message', async () => {
      setupTranslate({
        api_key: 'sk-test',
        base_url: 'https://api.example.com',
        api_style: 'openai',
      })
      useTranslationStore.getState().setTargetLanguage('ja')

      await useTranslationStore.getState().translate()

      expect(invokeMock).toHaveBeenCalledWith('create_conversation', {
        req: { title: '__translation__' },
      })
      const listenedEvents = listenMock.mock.calls.map(([event]) => event)
      expect(listenedEvents).toEqual(['chat-stream', 'chat-complete', 'chat-error'])
      expect(invokeMock).toHaveBeenCalledWith(
        'send_message',
        expect.objectContaining({
          conversationId: 'conv-1',
          content: 'hello',
          provider: 'openai',
          model: 'test-model-x',
          apiKey: 'sk-test',
          baseUrl: 'https://api.example.com',
          apiStyle: 'openai',
          includeHistory: false,
          searchEnabled: false,
          useProviderDefaults: true,
          disableTools: true,
          systemPrompt: expect.stringContaining('the source language'),
        })
      )
      expect(invokeMock).toHaveBeenCalledWith(
        'send_message',
        expect.objectContaining({
          systemPrompt: expect.stringContaining('Japanese'),
        })
      )
      const state = useTranslationStore.getState()
      expect(state.isTranslating).toBe(true)
      expect(state.error).toBeNull()
      expect(state.outputText).toBe('')
      expect(state.canContinue).toBe(false)
      expect(state.conversationId).toBe('conv-1')
      expect(state.unlistenFns).toHaveLength(3)
    })

    it('names the concrete source language in the prompt when not auto', async () => {
      setupTranslate()
      useTranslationStore.getState().setSourceLanguage('fr')
      useTranslationStore.getState().setTargetLanguage('en')

      await useTranslationStore.getState().translate()

      expect(invokeMock).toHaveBeenCalledWith(
        'send_message',
        expect.objectContaining({
          systemPrompt: expect.stringContaining('French'),
        })
      )
    })

    it('accumulates stream chunks, strips reasoning tags and ignores other conversations', async () => {
      setupTranslate()

      await useTranslationStore.getState().translate()

      // Event for a different conversation must be ignored
      fire('chat-stream', { conversation_id: 'other-conv', content: 'ignored' })
      expect(useTranslationStore.getState().outputText).toBe('')

      // Reasoning streamed before its closing tag produces no visible output
      fire('chat-stream', { conversation_id: 'conv-1', content: '<think>secret' })
      expect(useTranslationStore.getState().outputText).toBe('')

      // Closing the tag reveals only the translated content
      fire('chat-stream', { conversation_id: 'conv-1', content: ' thoughts</think>Bonjour' })
      expect(useTranslationStore.getState().outputText).toBe('Bonjour')
      expect(useTranslationStore.getState().isTranslating).toBe(true)
    })

    it('finalizes on chat-complete, enables continue, cleans up and deletes the temp conversation', async () => {
      const { model } = setupTranslate()

      await useTranslationStore.getState().translate()
      fire('chat-stream', { conversation_id: 'conv-1', content: '<think>x</think>Bonjour' })
      fire('chat-complete', { conversation_id: 'conv-1', message: {} })

      const state = useTranslationStore.getState()
      expect(state.outputText).toBe('Bonjour')
      expect(state.isTranslating).toBe(false)
      expect(state.canContinue).toBe(true)
      expect(state.lastTranslationContext).toEqual({
        sourceLanguage: 'auto',
        targetLanguage: 'en',
        inputText: 'hello',
        outputText: 'Bonjour',
        selectedModel: model,
      })
      expect(state.unlistenFns).toEqual([])
      expect(state.conversationId).toBeNull()
      unlistenSpies.forEach((unlisten) => expect(unlisten).toHaveBeenCalled())
      expect(invokeMock).toHaveBeenCalledWith('delete_conversation', { id: 'conv-1' })
    })

    it('stops translating and surfaces the error on chat-error', async () => {
      setupTranslate()

      await useTranslationStore.getState().translate()
      fire('chat-error', { conversation_id: 'conv-1', error: 'stream blew up' })

      const state = useTranslationStore.getState()
      expect(state.isTranslating).toBe(false)
      expect(state.error).toBe('stream blew up')
      expect(state.unlistenFns).toEqual([])
      expect(state.conversationId).toBeNull()
      expect(invokeMock).toHaveBeenCalledWith('delete_conversation', { id: 'conv-1' })
    })

    it('resets state, logs and skips deletion when creating the conversation fails', async () => {
      setupTranslate()
      invokeMock.mockImplementation(async () => {
        throw new Error('create failed')
      })

      await useTranslationStore.getState().translate()

      const state = useTranslationStore.getState()
      expect(state.isTranslating).toBe(false)
      expect(state.error).toBe('Error: create failed')
      expect(state.conversationId).toBeNull()
      expect(state.unlistenFns).toEqual([])
      expect(logger.error).toHaveBeenCalledWith(
        '[translationStore] Translation failed:',
        expect.any(Error)
      )
      expect(invokeMock.mock.calls.some(([cmd]) => cmd === 'delete_conversation')).toBe(false)
    })

    it('unlistens and deletes the temp conversation when sending fails', async () => {
      setupTranslate()
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === 'create_conversation') return { id: 'conv-1' }
        if (cmd === 'send_message') throw new Error('send failed')
        return undefined
      })

      await useTranslationStore.getState().translate()

      const state = useTranslationStore.getState()
      expect(state.isTranslating).toBe(false)
      expect(state.error).toBe('Error: send failed')
      expect(state.unlistenFns).toEqual([])
      expect(state.conversationId).toBeNull()
      unlistenSpies.forEach((unlisten) => expect(unlisten).toHaveBeenCalled())
      expect(invokeMock).toHaveBeenCalledWith('delete_conversation', { id: 'conv-1' })
    })
  })

  describe('stopTranslation', () => {
    it('stops generation, cleans up listeners and deletes the temp conversation', () => {
      const unlisten = vi.fn()
      useTranslationStore.setState({
        conversationId: 'conv-9',
        isTranslating: true,
        unlistenFns: [unlisten],
      })

      useTranslationStore.getState().stopTranslation()

      expect(invokeMock).toHaveBeenCalledWith('stop_generation', { conversationId: 'conv-9' })
      expect(invokeMock).toHaveBeenCalledWith('delete_conversation', { id: 'conv-9' })
      const state = useTranslationStore.getState()
      expect(state.isTranslating).toBe(false)
      expect(state.unlistenFns).toEqual([])
      expect(state.conversationId).toBeNull()
      expect(unlisten).toHaveBeenCalled()
    })

    it('skips backend calls when there is no active conversation', () => {
      useTranslationStore.setState({ isTranslating: true })

      useTranslationStore.getState().stopTranslation()

      const calledCommands = invokeMock.mock.calls.map(([cmd]) => cmd)
      expect(calledCommands).not.toContain('stop_generation')
      expect(calledCommands).not.toContain('delete_conversation')
      expect(useTranslationStore.getState().isTranslating).toBe(false)
    })
  })

  describe('clear', () => {
    it('resets texts, error and continue state but keeps languages', () => {
      useTranslationStore.setState({
        sourceLanguage: 'en',
        targetLanguage: 'ja',
        inputText: 'hello',
        outputText: 'こんにちは',
        error: 'some error',
        canContinue: true,
        lastTranslationContext: {
          sourceLanguage: 'en',
          targetLanguage: 'ja',
          inputText: 'hello',
          outputText: 'こんにちは',
          selectedModel: createMockModel(),
        },
      })

      useTranslationStore.getState().clear()

      const state = useTranslationStore.getState()
      expect(state.inputText).toBe('')
      expect(state.outputText).toBe('')
      expect(state.error).toBeNull()
      expect(state.canContinue).toBe(false)
      expect(state.lastTranslationContext).toBeNull()
      expect(state.sourceLanguage).toBe('en')
      expect(state.targetLanguage).toBe('ja')
    })
  })

  describe('cleanup', () => {
    it('runs every unlisten fn and clears listeners plus conversation id', () => {
      const first = vi.fn()
      const second = vi.fn()
      useTranslationStore.setState({
        conversationId: 'conv-5',
        unlistenFns: [first, second],
      })

      useTranslationStore.getState().cleanup()

      expect(first).toHaveBeenCalled()
      expect(second).toHaveBeenCalled()
      const state = useTranslationStore.getState()
      expect(state.unlistenFns).toEqual([])
      expect(state.conversationId).toBeNull()
    })
  })

  describe('continueInConversation', () => {
    it('returns early when there is no translation context', async () => {
      await useTranslationStore.getState().continueInConversation()

      expect(invokeMock).not.toHaveBeenCalled()
      expect(setSystemPrompt).not.toHaveBeenCalled()
    })

    it('recreates the translation as a conversation and opens it', async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === 'create_conversation') return { id: 'conv-2' }
        return undefined
      })
      const model = seedTranslationContext()
      useTranslationStore.setState({ inputText: 'hello', outputText: 'こんにちは' })

      await useTranslationStore.getState().continueInConversation()

      expect(invokeMock).toHaveBeenCalledWith('create_conversation', {
        req: { title: 'English → Japanese: hello' },
      })
      expect(setSystemPrompt).toHaveBeenCalledWith(
        'conv-2',
        'custom',
        null,
        expect.stringContaining('multilingual language assistant')
      )
      expect(invokeMock).toHaveBeenCalledWith('add_conversation_participant', {
        req: {
          conversation_id: 'conv-2',
          participant_type: 'model',
          participant_id: model.id,
          display_name: model.name,
        },
      })
      expect(invokeMock).toHaveBeenCalledWith('create_message', {
        req: {
          conversation_id: 'conv-2',
          sender_type: 'user',
          content: 'hello',
        },
      })
      expect(invokeMock).toHaveBeenCalledWith('create_message', {
        req: {
          conversation_id: 'conv-2',
          sender_type: 'model',
          sender_id: model.id,
          content: 'こんにちは',
        },
      })
      expect(selectConversation).toHaveBeenCalledWith('conv-2')
      const state = useTranslationStore.getState()
      expect(state.inputText).toBe('')
      expect(state.outputText).toBe('')
      expect(state.error).toBeNull()
      expect(state.lastTranslationContext).toBeNull()
      expect(state.canContinue).toBe(false)
    })

    it('truncates long input text in the generated title', async () => {
      seedTranslationContext({ inputText: 'a'.repeat(35) })

      await useTranslationStore.getState().continueInConversation()

      expect(invokeMock).toHaveBeenCalledWith('create_conversation', {
        req: { title: `English → Japanese: ${'a'.repeat(30)}...` },
      })
    })

    it('labels the source as Auto when the source language was auto', async () => {
      seedTranslationContext({ sourceLanguage: 'auto', targetLanguage: 'en', inputText: 'hi' })

      await useTranslationStore.getState().continueInConversation()

      expect(invokeMock).toHaveBeenCalledWith('create_conversation', {
        req: { title: 'Auto → English: hi' },
      })
    })

    it('logs and keeps the context when creating the conversation fails', async () => {
      seedTranslationContext()
      invokeMock.mockImplementation(async () => {
        throw new Error('no space left')
      })

      await expect(useTranslationStore.getState().continueInConversation()).resolves.toBeUndefined()

      expect(logger.error).toHaveBeenCalledWith(
        '[translationStore] Failed to continue in conversation:',
        expect.any(Error)
      )
      const state = useTranslationStore.getState()
      expect(state.canContinue).toBe(false)
      expect(state.lastTranslationContext).not.toBeNull()
    })
  })

  describe('initializeTranslationModel', () => {
    it('does nothing when no model id was persisted', () => {
      modelStoreState.models = [createMockModel()]

      initializeTranslationModel()

      expect(useTranslationStore.getState().selectedModel).toBeNull()
    })

    it('restores the persisted model when it is still available', () => {
      const model = createMockModel()
      modelStoreState.models = [model]
      localStorage.setItem('translation_selected_model_id', 'model-1')

      initializeTranslationModel()

      expect(useTranslationStore.getState().selectedModel).toEqual(model)
    })

    it('does not restore a model that has been deleted', () => {
      modelStoreState.models = [createMockModel({ is_deleted: true })]
      localStorage.setItem('translation_selected_model_id', 'model-1')

      initializeTranslationModel()

      expect(useTranslationStore.getState().selectedModel).toBeNull()
    })

    it('does not restore a model id that no longer exists', () => {
      modelStoreState.models = []
      localStorage.setItem('translation_selected_model_id', 'gone-model')

      initializeTranslationModel()

      expect(useTranslationStore.getState().selectedModel).toBeNull()
    })
  })
})
