import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { logger } from '@/lib/logger'
import { useAppInit } from '../useAppInit'
import { useConversationStore } from '@/stores/conversation'
import { useMessageStore } from '@/stores/message'
import { useAssistantStore } from '@/stores/assistantStore'
import { useModelStore } from '@/stores/modelStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore } from '@/stores/userStore'
import { usePromptStore } from '@/stores/promptStore'
import { useMcpStore } from '@/stores/mcpStore'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useAttachmentBlobStore } from '@/stores/attachmentBlobStore'
import type { Conversation, Model } from '@/types'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
  emit: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const NOW = '2026-01-01T00:00:00Z'

const makeConversation = (id: string): Conversation => ({
  id,
  title: `Chat ${id}`,
  created_at: NOW,
  updated_at: NOW,
})

const makeModel = (id: string, starred: boolean): Model => ({
  id,
  provider_id: 'provider-1',
  name: `Model ${id}`,
  model_id: id,
  is_starred: starred,
  is_deleted: false,
  created_at: NOW,
  updated_at: NOW,
})

let callOrder: string[]
let loadSettings: Mock
let getSetting: Mock
let loadSelfUser: Mock
let loadAll: Mock
let loadAssistants: Mock
let loadPrompts: Mock
let loadConversations: Mock
let loadServers: Mock
let selectConversation: Mock
let refreshAfterMerge: Mock
let unlisten: Mock
let syncMergedHandler: ((event: { payload: number }) => void) | undefined

function setupStores() {
  callOrder = []
  loadSettings = vi.fn(async () => {
    callOrder.push('loadSettings')
  })
  getSetting = vi.fn().mockResolvedValue('true')
  loadSelfUser = vi.fn(async () => {
    callOrder.push('loadSelfUser')
  })
  loadAll = vi.fn(async () => {
    callOrder.push('loadAll')
  })
  loadAssistants = vi.fn(async () => {
    callOrder.push('loadAssistants')
  })
  loadPrompts = vi.fn(async () => {
    callOrder.push('loadPrompts')
  })
  loadConversations = vi.fn(async () => {
    callOrder.push('loadConversations')
  })
  loadServers = vi.fn(async () => {
    callOrder.push('loadServers')
  })
  selectConversation = vi.fn().mockResolvedValue(undefined)
  refreshAfterMerge = vi.fn().mockResolvedValue(false)
  unlisten = vi.fn()
  syncMergedHandler = undefined

  vi.mocked(invoke).mockReset()
  vi.mocked(invoke).mockResolvedValue(true)
  vi.mocked(listen).mockReset()
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    if (event === 'sync-merged') syncMergedHandler = handler as unknown as typeof syncMergedHandler
    return unlisten
  })

  useSettingsStore.setState({
    settings: {},
    models: {},
    searchProviders: [],
    isLoading: false,
    error: null,
    loadSettings,
    getSetting,
  })
  useUserStore.setState({
    selfUser: null,
    users: [],
    isLoading: false,
    error: null,
    loadSelfUser,
  })
  useModelStore.setState({
    models: [],
    providers: [],
    isLoading: false,
    error: null,
    loadAll,
  })
  useAssistantStore.setState({
    assistants: [],
    currentAssistant: null,
    lastCreatedModelId: null,
    isLoading: false,
    error: null,
    loadAssistants,
  })
  usePromptStore.setState({
    prompts: [],
    isLoading: false,
    error: null,
    loadPrompts,
  })
  useConversationStore.setState({
    conversations: [],
    currentConversation: null,
    currentParticipants: [],
    selectedModel: null,
    selectedAssistant: null,
    lastUsedModel: null,
    lastUsedAssistant: null,
    isFirstConversationSinceStartup: true,
    isLoading: false,
    error: null,
    pendingInput: null,
    loadConversations,
    selectConversation,
  })
  useMcpStore.setState({ loadServers })
  useOnboardingStore.setState({ step: 'checking', isDialogOpen: false, flowOwnsSyncOffer: false })
  useAttachmentBlobStore.setState({ states: {}, refreshAfterMerge })
  useMessageStore.setState({
    conversationStates: {},
    isSending: false,
    error: null,
    onNewConversationCreated: undefined,
  })
}

async function renderInitialized() {
  const rendered = renderHook(() => useAppInit())
  await waitFor(() => expect(rendered.result.current.isInitialized).toBe(true))
  return rendered
}

describe('useAppInit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupStores()
  })

  describe('initialization sequence', () => {
    it('loads every store in order and reports success', async () => {
      const { result } = await renderInitialized()

      expect(callOrder).toEqual([
        'loadSettings',
        'loadSelfUser',
        'loadAll',
        'loadAssistants',
        'loadPrompts',
        'loadConversations',
        'loadServers',
      ])
      expect(result.current.error).toBeNull()
      expect(result.current.keychainAvailable).toBe(true)
      expect(useOnboardingStore.getState().isDialogOpen).toBe(false)
    })

    it('checks keychain availability through the backend', async () => {
      vi.mocked(invoke).mockResolvedValue(false)

      const { result } = await renderInitialized()

      expect(vi.mocked(invoke)).toHaveBeenCalledWith('is_keychain_available')
      expect(result.current.keychainAvailable).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith(
        'Keychain access denied, API keys will not persist across restarts'
      )
    })

    it('keeps the keychain default when the availability check fails', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('os error'))

      const { result } = await renderInitialized()

      expect(result.current.keychainAvailable).toBe(true)
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to check keychain availability:',
        expect.any(Error)
      )
      expect(result.current.error).toBeNull()
    })

    it('opens the onboarding flow when onboarding is not complete', async () => {
      getSetting.mockResolvedValue('false')

      await renderInitialized()

      expect(getSetting).toHaveBeenCalledWith('onboarding_complete')
      const onboarding = useOnboardingStore.getState()
      expect(onboarding.isDialogOpen).toBe(true)
      expect(onboarding.flowOwnsSyncOffer).toBe(true)
    })

    it('surfaces initialization errors while still finishing', async () => {
      loadSettings.mockRejectedValue(new Error('disk corrupt'))

      const { result } = await renderInitialized()

      expect(result.current.isInitialized).toBe(true)
      expect(result.current.error).toBe('Error: disk corrupt')
      expect(logger.error).toHaveBeenCalledWith('Failed to initialize app:', expect.any(Error))
    })
  })

  describe('sync-merged subscription', () => {
    it('reloads conversations and refreshes attachment blobs after a merge', async () => {
      await renderInitialized()
      expect(loadConversations).toHaveBeenCalledTimes(1)

      act(() => {
        syncMergedHandler?.({ payload: 3 })
      })

      await waitFor(() => expect(loadConversations).toHaveBeenCalledTimes(2))
      expect(refreshAfterMerge).toHaveBeenCalledTimes(1)
    })

    it('logs reload and self-heal failures without breaking', async () => {
      await renderInitialized()
      loadConversations.mockRejectedValue(new Error('db busy'))
      refreshAfterMerge.mockRejectedValue(new Error('blob store down'))

      act(() => {
        syncMergedHandler?.({ payload: 1 })
      })

      await waitFor(() =>
        expect(logger.error).toHaveBeenCalledWith(
          'Failed to reload conversations after sync:',
          expect.any(Error)
        )
      )
      expect(logger.error).toHaveBeenCalledWith(
        'Attachment blob self-heal failed:',
        expect.any(Error)
      )
    })

    it('unsubscribes on unmount', async () => {
      const { unmount } = await renderInitialized()

      unmount()

      expect(unlisten).toHaveBeenCalledTimes(1)
    })

    it('unsubscribes immediately when unmounted before the subscription resolves', async () => {
      const { promise, resolve } = Promise.withResolvers<() => void>()
      vi.mocked(listen).mockImplementation(() => promise)

      const { unmount } = renderHook(() => useAppInit())
      unmount()

      await act(async () => {
        resolve(unlisten)
        await promise
      })

      expect(unlisten).toHaveBeenCalledTimes(1)
    })

    it('logs a subscription failure without breaking initialization', async () => {
      vi.mocked(listen).mockRejectedValue(new Error('event system down'))

      const { result } = await renderInitialized()

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to subscribe to sync-merged events:',
        expect.any(Error)
      )
      expect(result.current.error).toBeNull()
    })
  })

  describe('message store callback wiring', () => {
    it('registers onNewConversationCreated and clears it on unmount', async () => {
      const { unmount } = await renderInitialized()

      expect(typeof useMessageStore.getState().onNewConversationCreated).toBe('function')

      unmount()

      expect(useMessageStore.getState().onNewConversationCreated).toBeUndefined()
    })

    it('selects a freshly created conversation and reloads the list', async () => {
      await renderInitialized()
      expect(loadConversations).toHaveBeenCalledTimes(1)

      const callback = useMessageStore.getState().onNewConversationCreated
      await act(async () => {
        await callback?.(makeConversation('conv-new'))
      })

      expect(selectConversation).toHaveBeenCalledWith('conv-new')
      expect(loadConversations).toHaveBeenCalledTimes(2)
    })

    it('skips the list reload when the conversation is already known', async () => {
      useConversationStore.setState({ conversations: [makeConversation('conv-existing')] })
      await renderInitialized()
      expect(loadConversations).toHaveBeenCalledTimes(1)

      const callback = useMessageStore.getState().onNewConversationCreated
      await act(async () => {
        await callback?.(makeConversation('conv-existing'))
      })

      expect(selectConversation).toHaveBeenCalledWith('conv-existing')
      expect(loadConversations).toHaveBeenCalledTimes(1)
    })
  })

  describe('initial selection', () => {
    it('selects the most recent conversation once history is loaded', async () => {
      useConversationStore.setState({
        conversations: [makeConversation('conv-latest'), makeConversation('conv-older')],
      })

      await renderInitialized()

      expect(selectConversation).toHaveBeenCalledWith('conv-latest')
      expect(useConversationStore.getState().isFirstConversationSinceStartup).toBe(true)
    })

    it('keeps the existing selection when a conversation is already open', async () => {
      const current = makeConversation('conv-open')
      useConversationStore.setState({
        conversations: [makeConversation('conv-latest'), current],
        currentConversation: current,
      })

      await renderInitialized()

      expect(selectConversation).not.toHaveBeenCalled()
    })

    it('defaults to the last starred model when there is no history', async () => {
      useModelStore.setState({
        models: [
          makeModel('model-a', false),
          makeModel('model-b', true),
          makeModel('model-c', true),
        ],
      })

      await renderInitialized()

      expect(useConversationStore.getState().selectedModel?.id).toBe('model-c')
      expect(useConversationStore.getState().isFirstConversationSinceStartup).toBe(false)
    })

    it('defaults to the last added model when none are starred', async () => {
      useModelStore.setState({ models: [makeModel('model-a', false), makeModel('model-b', false)] })

      await renderInitialized()

      expect(useConversationStore.getState().selectedModel?.id).toBe('model-b')
      expect(useConversationStore.getState().isFirstConversationSinceStartup).toBe(false)
    })

    it('makes no selection when no models exist', async () => {
      await renderInitialized()

      expect(useConversationStore.getState().selectedModel).toBeNull()
      expect(useConversationStore.getState().isFirstConversationSinceStartup).toBe(true)
      expect(selectConversation).not.toHaveBeenCalled()
    })
  })
})
