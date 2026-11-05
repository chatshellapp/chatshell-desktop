import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useTranslationStore,
  initializeTranslationLanguages,
  initializeTranslationModel,
  TRANSLATION_SETTING_KEYS,
  getDetectedLanguage,
  resolveDetectedLanguage,
  resolveMainSlot,
  type LanguageDetection,
} from '../translationStore'
import { logger } from '@/lib/logger'
import type { Model, Provider } from '@/types'

const {
  listenHandlers,
  unlistenSpies,
  modelStoreState,
  selectConversation,
  setSystemPrompt,
  recordHistory,
} = vi.hoisted(() => ({
  listenHandlers: new Map<string, (event: { payload: unknown }) => void>(),
  unlistenSpies: [] as Array<() => void>,
  modelStoreState: {
    models: [] as Array<Model>,
    providers: [] as Array<Provider>,
  },
  selectConversation: vi.fn(),
  setSystemPrompt: vi.fn(),
  recordHistory: vi.fn(),
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

vi.mock('../translationHistoryStore', () => ({
  useTranslationHistoryStore: { getState: () => ({ record: recordHistory }) },
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
      primaryLanguage: 'en',
      secondaryLanguage: 'ja',
      recentLanguages: [],
      otherLanguage: null,
      lastTarget: 'primary',
      languagesSetByUser: false,
      languagesLoaded: false,
      defaultsHintDismissed: false,
      activeTargetLanguage: null,
      lastAttempt: null,
      resultCache: {},
      inputText: '',
      outputText: '',
      isTranslating: false,
      error: null,
      conversationId: null,
      selectedModel: null,
      unlistenFns: [],
      canContinue: false,
      lastTranslationContext: null,
      detection: null,
      primarySuggestion: null,
      suggestionStreak: null,
      dismissedPrimarySuggestions: [],
    })
  })

  describe('initial state', () => {
    it('starts with defaults derived from the app language', () => {
      const state = useTranslationStore.getState()
      expect(state.sourceLanguage).toBe('auto')
      expect(state.primaryLanguage).toBe('en')
      expect(state.secondaryLanguage).toBe('ja')
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

  describe('simple setters', () => {
    it('setSourceLanguage updates the source language', () => {
      useTranslationStore.getState().setSourceLanguage('fr')
      expect(useTranslationStore.getState().sourceLanguage).toBe('fr')
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

  describe('language settings', () => {
    const savedSettings = () =>
      Object.fromEntries(
        invokeMock.mock.calls
          .filter(([cmd]) => cmd === 'set_setting')
          .map(([, args]) => {
            const { key, value } = args as { key: string; value: string }
            return [key, value]
          })
      )

    it('setPrimaryLanguage saves both languages and marks them as user-set', () => {
      useTranslationStore.getState().setPrimaryLanguage('ko')

      const state = useTranslationStore.getState()
      expect(state.primaryLanguage).toBe('ko')
      expect(state.secondaryLanguage).toBe('ja')
      expect(state.languagesSetByUser).toBe(true)
      expect(state.defaultsHintDismissed).toBe(true)
      expect(savedSettings()).toMatchObject({
        [TRANSLATION_SETTING_KEYS.primary]: 'ko',
        [TRANSLATION_SETTING_KEYS.secondary]: 'ja',
        [TRANSLATION_SETTING_KEYS.setByUser]: 'true',
      })
    })

    it('swaps instead of duplicating when picking the other slot language', () => {
      useTranslationStore.getState().setPrimaryLanguage('ja')
      expect(useTranslationStore.getState().primaryLanguage).toBe('ja')
      expect(useTranslationStore.getState().secondaryLanguage).toBe('en')

      useTranslationStore.getState().setSecondaryLanguage('ja')
      expect(useTranslationStore.getState().primaryLanguage).toBe('en')
      expect(useTranslationStore.getState().secondaryLanguage).toBe('ja')
    })

    it('ignores unsupported language codes', () => {
      useTranslationStore.getState().setPrimaryLanguage('xx')
      useTranslationStore.getState().setSecondaryLanguage('auto')

      expect(useTranslationStore.getState().primaryLanguage).toBe('en')
      expect(useTranslationStore.getState().secondaryLanguage).toBe('ja')
      expect(invokeMock).not.toHaveBeenCalled()
    })

    it('swapPrimaryAndSecondary swaps the languages and does nothing without a secondary', () => {
      useTranslationStore.getState().swapPrimaryAndSecondary()
      expect(useTranslationStore.getState().primaryLanguage).toBe('ja')
      expect(useTranslationStore.getState().secondaryLanguage).toBe('en')

      useTranslationStore.setState({ secondaryLanguage: null })
      useTranslationStore.getState().swapPrimaryAndSecondary()
      expect(useTranslationStore.getState().primaryLanguage).toBe('ja')
    })

    it('dismissDefaultsHint persists once', () => {
      useTranslationStore.getState().dismissDefaultsHint()
      useTranslationStore.getState().dismissDefaultsHint()

      expect(useTranslationStore.getState().defaultsHintDismissed).toBe(true)
      expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'set_setting')).toHaveLength(1)
    })
  })

  describe('target slots', () => {
    it('translateToSlot translates to the slot language and remembers the fixed slot', async () => {
      setupTranslate()

      await useTranslationStore.getState().translateToSlot('secondary')

      expect(useTranslationStore.getState().lastTarget).toBe('secondary')
      expect(useTranslationStore.getState().activeTargetLanguage).toBe('ja')
      expect(invokeMock).toHaveBeenCalledWith('set_setting', {
        key: TRANSLATION_SETTING_KEYS.lastTarget,
        value: 'secondary',
      })
      expect(invokeMock).toHaveBeenCalledWith(
        'send_message',
        expect.objectContaining({ systemPrompt: expect.stringContaining('to Japanese') })
      )
    })

    it('translateToSlot does nothing for an empty slot', async () => {
      setupTranslate()
      useTranslationStore.setState({ secondaryLanguage: null })

      await useTranslationStore.getState().translateToSlot('secondary')

      expect(useTranslationStore.getState().lastTarget).toBe('primary')
      expect(invokeMock).not.toHaveBeenCalled()
    })

    it('translateToOther shows a temporary button and records a recent language', async () => {
      setupTranslate()

      await useTranslationStore.getState().translateToOther('fr')

      const state = useTranslationStore.getState()
      expect(state.otherLanguage).toBe('fr')
      expect(state.lastTarget).toBe('other')
      expect(state.recentLanguages).toEqual(['fr'])
      expect(invokeMock).toHaveBeenCalledWith('set_setting', {
        key: TRANSLATION_SETTING_KEYS.recent,
        value: JSON.stringify(['fr']),
      })
      // The temporary slot is session-only.
      expect(invokeMock).not.toHaveBeenCalledWith('set_setting', {
        key: TRANSLATION_SETTING_KEYS.lastTarget,
        value: 'other',
      })
    })

    it('keeps recent languages unique, newest first and capped', async () => {
      setupTranslate()
      useTranslationStore.setState({ recentLanguages: ['de', 'fr', 'es', 'it', 'nl'] })

      await useTranslationStore.getState().translateToOther('es')

      expect(useTranslationStore.getState().recentLanguages).toEqual(['es', 'de', 'fr', 'it', 'nl'])
    })

    it('routes primary or secondary picks from the menu to their fixed slots', async () => {
      setupTranslate()

      await useTranslationStore.getState().translateToOther('ja')

      const state = useTranslationStore.getState()
      expect(state.otherLanguage).toBeNull()
      expect(state.lastTarget).toBe('secondary')
      expect(state.recentLanguages).toEqual([])
    })

    it('closeOtherLanguage removes the temporary button and falls back to primary', () => {
      useTranslationStore.setState({ otherLanguage: 'fr', lastTarget: 'other' })

      useTranslationStore.getState().closeOtherLanguage()

      expect(useTranslationStore.getState().otherLanguage).toBeNull()
      expect(useTranslationStore.getState().lastTarget).toBe('primary')
    })
  })

  describe('result cache and follow-up actions', () => {
    const completeTranslation = async (target: string, output: string) => {
      await useTranslationStore.getState().translate(target)
      fire('chat-stream', { conversation_id: 'conv-1', content: output })
      fire('chat-complete', { conversation_id: 'conv-1', message: {} })
    }

    it('reuses a cached result for the same input, source, target and model', async () => {
      setupTranslate()
      await completeTranslation('ja', 'konnichiwa')
      await completeTranslation('fr', 'bonjour')
      invokeMock.mockClear()

      await useTranslationStore.getState().translate('ja')

      const state = useTranslationStore.getState()
      expect(state.outputText).toBe('konnichiwa')
      expect(state.isTranslating).toBe(false)
      expect(state.canContinue).toBe(true)
      expect(state.lastAttempt).toEqual({ sourceLanguage: 'auto', targetLanguage: 'ja' })
      expect(invokeMock).not.toHaveBeenCalledWith('send_message', expect.anything())
    })

    it('retranslate bypasses the cache for the last direction', async () => {
      setupTranslate()
      await completeTranslation('ja', 'konnichiwa')
      invokeMock.mockClear()

      await useTranslationStore.getState().retranslate()

      expect(useTranslationStore.getState().isTranslating).toBe(true)
      expect(invokeMock).toHaveBeenCalledWith(
        'send_message',
        expect.objectContaining({ systemPrompt: expect.stringContaining('to Japanese') })
      )
    })

    it('records the attempt even when it fails validation so it can be retried', async () => {
      useTranslationStore.getState().setInputText('hello')

      await useTranslationStore.getState().translate('ja')

      expect(useTranslationStore.getState().lastAttempt).toEqual({
        sourceLanguage: 'auto',
        targetLanguage: 'ja',
      })
    })

    it('moveOutputToInput moves the translation into the input and resets the source', () => {
      useTranslationStore.setState({
        sourceLanguage: 'fr',
        inputText: 'bonjour',
        outputText: 'hello',
        canContinue: true,
        lastAttempt: { sourceLanguage: 'fr', targetLanguage: 'en' },
      })

      useTranslationStore.getState().moveOutputToInput()

      const state = useTranslationStore.getState()
      expect(state.inputText).toBe('hello')
      expect(state.outputText).toBe('')
      expect(state.sourceLanguage).toBe('auto')
      expect(state.canContinue).toBe(false)
      expect(state.lastAttempt).toBeNull()
    })

    it('moveOutputToInput does nothing while translating', () => {
      useTranslationStore.setState({ inputText: 'a', outputText: 'b', isTranslating: true })

      useTranslationStore.getState().moveOutputToInput()

      expect(useTranslationStore.getState().inputText).toBe('a')
    })
  })

  describe('initializeTranslationLanguages', () => {
    const mockSettings = (settings: Record<string, string>, systemLocales: string[] = []) => {
      invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === 'get_setting') return settings[(args as { key: string }).key] ?? null
        if (cmd === 'get_system_locales') return systemLocales
        return undefined
      })
    }

    it('derives defaults from the system locales, not the UI language', async () => {
      mockSettings({}, ['ko-KR', 'en-US'])

      await initializeTranslationLanguages()

      const state = useTranslationStore.getState()
      expect(state.primaryLanguage).toBe('ko')
      expect(state.secondaryLanguage).toBe('en')
      expect(state.languagesSetByUser).toBe(false)
      expect(state.languagesLoaded).toBe(true)
    })

    it('restores saved languages, recents and last target without reading locales', async () => {
      mockSettings({
        [TRANSLATION_SETTING_KEYS.setByUser]: 'true',
        [TRANSLATION_SETTING_KEYS.primary]: 'zh-Hant',
        [TRANSLATION_SETTING_KEYS.secondary]: 'ja',
        [TRANSLATION_SETTING_KEYS.recent]: JSON.stringify(['fr', 'bogus', 'de']),
        [TRANSLATION_SETTING_KEYS.lastTarget]: 'secondary',
        [TRANSLATION_SETTING_KEYS.hintDismissed]: 'true',
        [TRANSLATION_SETTING_KEYS.dismissedSuggestions]: JSON.stringify(['ko', 'nope']),
      })

      await initializeTranslationLanguages()

      const state = useTranslationStore.getState()
      expect(state.primaryLanguage).toBe('zh-Hant')
      expect(state.secondaryLanguage).toBe('ja')
      expect(state.recentLanguages).toEqual(['fr', 'de'])
      expect(state.lastTarget).toBe('secondary')
      expect(state.languagesSetByUser).toBe(true)
      expect(state.defaultsHintDismissed).toBe(true)
      expect(state.dismissedPrimarySuggestions).toEqual(['ko'])
      expect(invokeMock).not.toHaveBeenCalledWith('get_system_locales')
    })

    it('falls back to defaults when saved languages are invalid', async () => {
      mockSettings(
        {
          [TRANSLATION_SETTING_KEYS.setByUser]: 'true',
          [TRANSLATION_SETTING_KEYS.primary]: 'xx',
          [TRANSLATION_SETTING_KEYS.recent]: 'not json',
        },
        ['ja-JP']
      )

      await initializeTranslationLanguages()

      const state = useTranslationStore.getState()
      expect(state.primaryLanguage).toBe('ja')
      expect(state.secondaryLanguage).toBe('en')
      expect(state.recentLanguages).toEqual([])
    })

    it('uses the UI language when system locales cannot be read', async () => {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === 'get_system_locales') throw new Error('unavailable')
        return null
      })

      await initializeTranslationLanguages()

      expect(useTranslationStore.getState().primaryLanguage).toBe('en')
      expect(useTranslationStore.getState().secondaryLanguage).toBeNull()
    })

    it('keeps a language choice made while settings were loading', async () => {
      let resolveLocales!: (value: string[]) => void
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === 'get_system_locales')
          return new Promise<string[]>((resolve) => {
            resolveLocales = resolve
          })
        return Promise.resolve(null)
      })
      const initialization = initializeTranslationLanguages()
      await vi.waitFor(() => expect(resolveLocales).toBeDefined())
      useTranslationStore.getState().setPrimaryLanguage('de')
      resolveLocales(['ja-JP'])

      await initialization

      expect(useTranslationStore.getState().primaryLanguage).toBe('de')
    })

    it('runs only once', async () => {
      mockSettings({}, ['ja-JP'])
      await initializeTranslationLanguages()
      invokeMock.mockClear()

      await initializeTranslationLanguages()

      expect(invokeMock).not.toHaveBeenCalled()
    })
  })

  describe('language detection', () => {
    const reliable = (language: string | null): LanguageDetection => ({
      language,
      confidence: 0.9,
      reliable: true,
    })
    const detect = (text: string, result: LanguageDetection = reliable('fr')) =>
      useTranslationStore.setState({ inputText: text, detection: { text, result } })

    it('detectInputLanguage stores the result for the current text', async () => {
      invokeMock.mockResolvedValueOnce(reliable('ja'))
      useTranslationStore.getState().setInputText('text')

      await useTranslationStore.getState().detectInputLanguage()

      expect(invokeMock).toHaveBeenCalledWith('detect_language', { text: 'text' })
      expect(useTranslationStore.getState().detection).toEqual({
        text: 'text',
        result: reliable('ja'),
      })
    })

    it('drops results for text that changed while detecting', async () => {
      let resolve!: (value: LanguageDetection) => void
      invokeMock.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
      useTranslationStore.getState().setInputText('old')
      const pending = useTranslationStore.getState().detectInputLanguage()
      useTranslationStore.getState().setInputText('new')
      resolve(reliable('ja'))

      await pending

      expect(useTranslationStore.getState().detection).toBeNull()
    })

    it('clears detection for empty input without calling the backend', async () => {
      detect('x')
      useTranslationStore.setState({ inputText: '  ' })

      await useTranslationStore.getState().detectInputLanguage()

      expect(invokeMock).not.toHaveBeenCalled()
      expect(useTranslationStore.getState().detection).toBeNull()
    })

    it('clears detection when the command fails', async () => {
      detect('x')
      invokeMock.mockRejectedValueOnce(new Error('boom'))

      await useTranslationStore.getState().detectInputLanguage()

      expect(useTranslationStore.getState().detection).toBeNull()
      expect(logger.warn).toHaveBeenCalled()
    })

    it('getDetectedLanguage ignores stale, uncertain and unsupported results', () => {
      detect('bonjour')
      expect(getDetectedLanguage(useTranslationStore.getState())).toBe('fr')

      useTranslationStore.setState({ inputText: 'changed' })
      expect(getDetectedLanguage(useTranslationStore.getState())).toBeNull()

      detect('salut', { language: 'fr', confidence: 0.1, reliable: false })
      expect(getDetectedLanguage(useTranslationStore.getState())).toBeNull()

      detect('?', reliable(null))
      expect(getDetectedLanguage(useTranslationStore.getState())).toBeNull()
    })

    it('resolves Portuguese to the variant the user works with', () => {
      expect(resolveDetectedLanguage('pt', ['en', 'pt-PT'])).toBe('pt-PT')
      expect(resolveDetectedLanguage('pt', ['en', null])).toBe('pt-BR')
      expect(resolveDetectedLanguage('zh-Hant', [])).toBe('zh-Hant')
      expect(resolveDetectedLanguage('xx', [])).toBeNull()
    })

    it('names the detected source in the prompt and the attempt', async () => {
      setupTranslate()
      detect('hello', reliable('fr'))

      await useTranslationStore.getState().translate('en')

      expect(useTranslationStore.getState().lastAttempt).toEqual({
        sourceLanguage: 'fr',
        targetLanguage: 'en',
      })
      expect(invokeMock).toHaveBeenCalledWith(
        'send_message',
        expect.objectContaining({ systemPrompt: expect.stringContaining('from French to English') })
      )
    })

    it('prefers a manual source over detection', async () => {
      setupTranslate()
      detect('hello', reliable('fr'))
      useTranslationStore.getState().setSourceLanguage('de')

      await useTranslationStore.getState().translate('en')

      expect(useTranslationStore.getState().lastAttempt?.sourceLanguage).toBe('de')
    })

    it('resets a manual source when the input is emptied', () => {
      useTranslationStore.getState().setInputText('hallo')
      useTranslationStore.getState().setSourceLanguage('de')
      useTranslationStore.getState().setInputText('hallo welt')
      expect(useTranslationStore.getState().sourceLanguage).toBe('de')

      useTranslationStore.getState().setInputText('')
      expect(useTranslationStore.getState().sourceLanguage).toBe('auto')
    })
  })

  describe('resolveMainSlot', () => {
    const slotFor = (overrides: Record<string, unknown>) => {
      useTranslationStore.setState({ inputText: 't', ...overrides })
      return resolveMainSlot(useTranslationStore.getState())
    }
    const detected = (language: string, reliable = true) => ({
      detection: { text: 't', result: { language, confidence: 0.9, reliable } },
    })

    it('sends primary-language text to the secondary language', () => {
      expect(slotFor(detected('en'))).toBe('secondary')
    })

    it('sends any other language to the primary language, even after using another button', () => {
      expect(slotFor({ ...detected('ja'), lastTarget: 'secondary' })).toBe('primary')
      expect(slotFor({ ...detected('fr'), lastTarget: 'other', otherLanguage: 'de' })).toBe(
        'primary'
      )
    })

    it('uses a manual source like a detection', () => {
      expect(slotFor({ sourceLanguage: 'en' })).toBe('secondary')
    })

    it('falls back to the last button when uncertain or without a secondary', () => {
      expect(slotFor({ ...detected('en', false), lastTarget: 'secondary' })).toBe('secondary')
      expect(slotFor({ ...detected('en'), secondaryLanguage: null })).toBe('primary')
      expect(slotFor({ lastTarget: 'other', otherLanguage: 'de' })).toBe('other')
      expect(slotFor({ lastTarget: 'other', otherLanguage: null })).toBe('primary')
    })
  })

  describe('primary language suggestion', () => {
    // Primary is English; the user keeps translating French text into Korean.
    const translateForeignTo = async (target: string, source = 'fr') => {
      useTranslationStore.setState({
        inputText: `${source}-text`,
        detection: {
          text: `${source}-text`,
          result: { language: source, confidence: 0.9, reliable: true },
        },
      })
      await useTranslationStore.getState().translateToOther(target)
      // Finish the request so the next press is not ignored as overlapping.
      if (useTranslationStore.getState().isTranslating) {
        fire('chat-complete', { conversation_id: 'conv-1', message: {} })
      }
    }

    beforeEach(() => {
      setupTranslate()
    })

    it('offers the language after three foreign translations in a row', async () => {
      await translateForeignTo('ko')
      await translateForeignTo('ko')
      expect(useTranslationStore.getState().primarySuggestion).toBeNull()

      await translateForeignTo('ko')
      expect(useTranslationStore.getState().primarySuggestion).toBe('ko')
    })

    it('restarts the streak for a different target or non-foreign text', async () => {
      await translateForeignTo('ko')
      await translateForeignTo('ko')
      await translateForeignTo('de')
      await translateForeignTo('ko')
      expect(useTranslationStore.getState().suggestionStreak).toEqual({ language: 'ko', count: 1 })

      await translateForeignTo('ko', 'en')
      expect(useTranslationStore.getState().suggestionStreak).toBeNull()
    })

    it('accepting makes it the primary language', async () => {
      for (let i = 0; i < 3; i++) await translateForeignTo('ko')

      useTranslationStore.getState().acceptPrimarySuggestion()

      const state = useTranslationStore.getState()
      expect(state.primaryLanguage).toBe('ko')
      expect(state.primarySuggestion).toBeNull()
      expect(state.languagesSetByUser).toBe(true)
    })

    it('dismissing persists and suppresses that language', async () => {
      for (let i = 0; i < 3; i++) await translateForeignTo('ko')

      useTranslationStore.getState().dismissPrimarySuggestion()
      for (let i = 0; i < 3; i++) await translateForeignTo('ko')

      expect(useTranslationStore.getState().primarySuggestion).toBeNull()
      expect(useTranslationStore.getState().primaryLanguage).toBe('en')
      expect(invokeMock).toHaveBeenCalledWith('set_setting', {
        key: TRANSLATION_SETTING_KEYS.dismissedSuggestions,
        value: JSON.stringify(['ko']),
      })
    })
  })

  describe('translate', () => {
    it('returns early without invoking when input is blank', async () => {
      setupTranslate()
      useTranslationStore.getState().setInputText('   ')

      await useTranslationStore.getState().translate('en')

      expect(invokeMock).not.toHaveBeenCalled()
      expect(useTranslationStore.getState().isTranslating).toBe(false)
    })

    it('sets an error when no model is selected', async () => {
      useTranslationStore.getState().setInputText('hello')

      await useTranslationStore.getState().translate('en')

      const state = useTranslationStore.getState()
      expect(state.error).toBe('t:sidebar:selectModelError')
      expect(state.isTranslating).toBe(false)
      expect(invokeMock).not.toHaveBeenCalled()
    })

    it('sets an error when the provider of the model is not loaded', async () => {
      setupTranslate()
      modelStoreState.providers = []

      await useTranslationStore.getState().translate('en')

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

      await useTranslationStore.getState().translate('ja')

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

      await useTranslationStore.getState().translate('en')

      expect(invokeMock).toHaveBeenCalledWith(
        'send_message',
        expect.objectContaining({
          systemPrompt: expect.stringContaining('French'),
        })
      )
    })

    it('accumulates stream chunks, strips reasoning tags and ignores other conversations', async () => {
      setupTranslate()

      await useTranslationStore.getState().translate('en')

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

      await useTranslationStore.getState().translate('en')
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

    it('records the finished translation in history', async () => {
      setupTranslate()

      await useTranslationStore.getState().translate('fr')
      fire('chat-stream', { conversation_id: 'conv-1', content: '<think>x</think>Bonjour' })
      expect(recordHistory).not.toHaveBeenCalled()
      fire('chat-complete', { conversation_id: 'conv-1', message: {} })

      expect(recordHistory).toHaveBeenCalledTimes(1)
      expect(recordHistory).toHaveBeenCalledWith({
        source_text: 'hello',
        translated_text: 'Bonjour',
        source_language: 'auto',
        target_language: 'fr',
        model_id: 'model-1',
      })
    })

    it('does not record failed translations in history', async () => {
      setupTranslate()

      await useTranslationStore.getState().translate('fr')
      fire('chat-error', { conversation_id: 'conv-1', error: 'nope' })

      expect(recordHistory).not.toHaveBeenCalled()
    })

    it('restores a history entry without calling the model', () => {
      const model = createMockModel()
      useTranslationStore.setState({ selectedModel: model, sourceLanguage: 'de', error: 'old' })

      useTranslationStore.getState().restoreFromHistory({
        id: 'h1',
        source_text: 'hello',
        translated_text: 'bonjour',
        source_language: 'en',
        target_language: 'fr',
        model_id: 'model-9',
        created_at: '2026-11-02T00:00:00Z',
      })

      const state = useTranslationStore.getState()
      expect(state.inputText).toBe('hello')
      expect(state.outputText).toBe('bonjour')
      expect(state.sourceLanguage).toBe('auto')
      expect(state.error).toBeNull()
      expect(state.lastAttempt).toEqual({ sourceLanguage: 'en', targetLanguage: 'fr' })
      expect(state.canContinue).toBe(true)
      expect(state.lastTranslationContext).toEqual({
        sourceLanguage: 'en',
        targetLanguage: 'fr',
        inputText: 'hello',
        outputText: 'bonjour',
        selectedModel: model,
      })
      expect(invokeMock).not.toHaveBeenCalled()
    })

    it('ignores history restores while translating', () => {
      useTranslationStore.setState({ isTranslating: true, inputText: 'busy' })

      useTranslationStore.getState().restoreFromHistory({
        id: 'h1',
        source_text: 'hello',
        translated_text: 'bonjour',
        source_language: 'auto',
        target_language: 'fr',
        model_id: null,
        created_at: '2026-11-02T00:00:00Z',
      })

      expect(useTranslationStore.getState().inputText).toBe('busy')
    })

    it('stops translating and surfaces the error on chat-error', async () => {
      setupTranslate()

      await useTranslationStore.getState().translate('en')
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

      await useTranslationStore.getState().translate('en')

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

      await useTranslationStore.getState().translate('en')

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
    it('resets texts, error, continue state and the manual source but keeps languages', () => {
      useTranslationStore.setState({
        sourceLanguage: 'en',
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
      expect(state.sourceLanguage).toBe('auto')
      expect(state.primaryLanguage).toBe('en')
      expect(state.lastAttempt).toBeNull()
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
    beforeEach(() => {
      modelStoreState.providers = [createMockProvider()]
    })
    it('does nothing when no model id was persisted', async () => {
      modelStoreState.models = [createMockModel()]

      await initializeTranslationModel()

      expect(useTranslationStore.getState().selectedModel).toBeNull()
    })

    it('restores the persisted model when it is still available', async () => {
      const model = createMockModel()
      modelStoreState.models = [model]
      localStorage.setItem('translation_selected_model_id', 'model-1')

      await initializeTranslationModel()

      expect(useTranslationStore.getState().selectedModel).toEqual(model)
    })

    it('does not restore a model that has been deleted', async () => {
      modelStoreState.models = [createMockModel({ is_deleted: true })]
      localStorage.setItem('translation_selected_model_id', 'model-1')

      await initializeTranslationModel()

      expect(useTranslationStore.getState().selectedModel).toBeNull()
    })

    it('does not restore a model id that no longer exists', async () => {
      modelStoreState.models = []
      localStorage.setItem('translation_selected_model_id', 'gone-model')

      await initializeTranslationModel()

      expect(useTranslationStore.getState().selectedModel).toBeNull()
    })

    it('defaults to the configured lightweight model without persisting an override', async () => {
      const model = createMockModel()
      modelStoreState.models = [model]
      invokeMock.mockResolvedValueOnce(model.id)

      await initializeTranslationModel()

      expect(invokeMock).toHaveBeenCalledWith('get_setting', { key: 'aux_tiny_model_id' })
      expect(useTranslationStore.getState().selectedModel).toEqual(model)
      expect(localStorage.getItem('translation_selected_model_id')).toBeNull()
    })

    it('prefers the saved translation selection over the lightweight model', async () => {
      const model = createMockModel()
      modelStoreState.models = [model]
      localStorage.setItem('translation_selected_model_id', model.id)

      await initializeTranslationModel()

      expect(useTranslationStore.getState().selectedModel).toEqual(model)
      expect(invokeMock).not.toHaveBeenCalled()
    })

    it('falls back to the lightweight model when the saved selection is unavailable', async () => {
      const model = createMockModel()
      modelStoreState.models = [model]
      localStorage.setItem('translation_selected_model_id', 'missing-model')
      invokeMock.mockResolvedValueOnce(model.id)

      await initializeTranslationModel()

      expect(useTranslationStore.getState().selectedModel).toEqual(model)
      expect(localStorage.getItem('translation_selected_model_id')).toBe('missing-model')
    })

    it.each(['deleted', 'missing', 'disabled-provider', 'missing-provider'])(
      'does not select an unavailable lightweight model: %s',
      async (reason) => {
        modelStoreState.models =
          reason === 'missing' ? [] : [createMockModel({ is_deleted: reason === 'deleted' })]
        if (reason === 'disabled-provider')
          modelStoreState.providers = [createMockProvider({ is_enabled: false })]
        if (reason === 'missing-provider') modelStoreState.providers = []
        invokeMock.mockResolvedValueOnce('model-1')

        await initializeTranslationModel()

        expect(useTranslationStore.getState().selectedModel).toBeNull()
      }
    )

    it('does not replace a manual selection made while loading the default', async () => {
      let resolveSetting!: (value: string) => void
      invokeMock.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveSetting = resolve
          })
      )
      const initialization = initializeTranslationModel()
      const manualModel = createMockModel({ id: 'manual-model' })
      useTranslationStore.getState().setSelectedModel(manualModel)
      resolveSetting('model-1')

      await initialization

      expect(useTranslationStore.getState().selectedModel).toEqual(manualModel)
    })
  })
})
