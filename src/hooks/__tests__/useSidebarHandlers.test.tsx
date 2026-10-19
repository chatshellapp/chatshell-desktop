import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { useSidebarHandlers } from '../useSidebarHandlers'
import { useConversationStore } from '@/stores/conversation'
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { useModelStore } from '@/stores/modelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { usePromptStore } from '@/stores/promptStore'
import { useSkillStore } from '@/stores/skillStore'
import type { Model as ModelListItem } from '@/components/model-list'
import type { Assistant as AssistantListItem } from '@/components/assistant-list'
import type { Prompt as PromptListItem } from '@/components/prompt-list'
import type { Assistant, Conversation, Message, Model, Prompt } from '@/types'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const NOW = '2026-01-01T00:00:00Z'

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

const assistant: Assistant = {
  id: 'assistant-1',
  name: 'Helper',
  system_prompt: 'assistant system prompt',
  model_id: 'model-1',
  tool_ids: ['tool-1'],
  skill_ids: ['skill-1'],
  avatar_type: 'text',
  is_starred: false,
  created_at: NOW,
  updated_at: NOW,
}

const prompt: Prompt = {
  id: 'prompt-1',
  name: 'Summarize',
  content: 'Summarize the following text',
  is_system: false,
  is_starred: false,
  created_at: NOW,
  updated_at: NOW,
}

const conversation: Conversation = {
  id: 'conv-1',
  title: 'Existing chat',
  created_at: NOW,
  updated_at: NOW,
}

const createdConversation: Conversation = {
  id: 'conv-new',
  title: '',
  created_at: NOW,
  updated_at: NOW,
}

const message: Message = {
  id: 'msg-1',
  conversation_id: 'conv-1',
  sender_type: 'user',
  content: 'hello',
  created_at: NOW,
}

const modelItem: ModelListItem = {
  id: 'model-1',
  name: 'GPT-4o',
  modelId: 'gpt-4o',
  providerName: 'OpenAI',
}

const assistantItem: AssistantListItem = { id: 'assistant-1', name: 'Helper' }
const promptItem: PromptListItem = { id: 'prompt-1', name: 'Summarize', content: 'text' }

let createConversation: Mock
let selectConversation: Mock
let updateConversation: Mock
let deleteConversation: Mock
let updateModel: Mock
let deleteModel: Mock
let updateAssistant: Mock
let deleteAssistant: Mock
let deletePrompt: Mock
let resetToolsAndSkillsToGlobal: Mock
let initSettingsFromAssistant: Mock
let scanSkills: Mock

function setupStores() {
  createConversation = vi.fn().mockResolvedValue(createdConversation)
  selectConversation = vi.fn().mockResolvedValue(undefined)
  updateConversation = vi.fn().mockResolvedValue(conversation)
  deleteConversation = vi.fn().mockResolvedValue(undefined)
  updateModel = vi.fn().mockResolvedValue(model)
  deleteModel = vi.fn().mockResolvedValue(undefined)
  updateAssistant = vi.fn().mockResolvedValue(assistant)
  deleteAssistant = vi.fn().mockResolvedValue(undefined)
  deletePrompt = vi.fn().mockResolvedValue(undefined)
  resetToolsAndSkillsToGlobal = vi.fn().mockResolvedValue(undefined)
  initSettingsFromAssistant = vi.fn().mockResolvedValue(undefined)
  scanSkills = vi.fn().mockResolvedValue(undefined)

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
    createConversation,
    selectConversation,
    updateConversation,
    deleteConversation,
  })
  useModelStore.setState({
    models: [model],
    providers: [],
    isLoading: false,
    error: null,
    updateModel,
    deleteModel,
  })
  useAssistantStore.setState({
    assistants: [assistant],
    currentAssistant: null,
    lastCreatedModelId: null,
    isLoading: false,
    error: null,
    updateAssistant,
    deleteAssistant,
  })
  usePromptStore.setState({
    prompts: [prompt],
    isLoading: false,
    error: null,
    deletePrompt,
  })
  useConversationSettingsStore.setState({
    resetToolsAndSkillsToGlobal,
    initSettingsFromAssistant,
  })
  useSkillStore.setState({ scanSkills })
}

// Lists the latest message page for a conversation; null means the backend call fails
function mockLatestMessages(messages: Message[] | null) {
  if (messages === null) {
    vi.mocked(invoke).mockRejectedValue(new Error('boom'))
    return
  }
  vi.mocked(invoke).mockImplementation((async (cmd: string) => {
    if (cmd === 'list_messages_by_conversation') return messages
    if (cmd === 'generate_conversation_title_manually') return 'Generated Title'
    return undefined
  }) as typeof invoke)
}

describe('useSidebarHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockReset()
    setupStores()
    mockLatestMessages([])
  })

  describe('handleModelClick', () => {
    it('logs and does nothing when the model is unknown to the store', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleModelClick({ ...modelItem, id: 'missing-model' })
      })

      expect(logger.error).toHaveBeenCalledWith('Model not found:', 'missing-model')
      expect(selectConversation).not.toHaveBeenCalled()
      expect(createConversation).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('reuses the latest conversation when it has no messages', async () => {
      useConversationStore.setState({ conversations: [conversation] })
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleModelClick(modelItem)
      })

      expect(invoke).toHaveBeenCalledWith('list_messages_by_conversation', {
        conversationId: 'conv-1',
        limit: 1,
      })
      expect(createConversation).not.toHaveBeenCalled()
      expect(selectConversation).toHaveBeenCalledWith('conv-1')
      const state = useConversationStore.getState()
      expect(state.selectedModel?.id).toBe('model-1')
      expect(state.selectedAssistant).toBeNull()
      expect(resetToolsAndSkillsToGlobal).not.toHaveBeenCalled()
    })

    it('resets tools and skills when switching away from an assistant', async () => {
      useConversationStore.setState({ conversations: [conversation], selectedAssistant: assistant })
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleModelClick(modelItem)
      })

      expect(resetToolsAndSkillsToGlobal).toHaveBeenCalledWith('conv-1')
      const state = useConversationStore.getState()
      expect(state.selectedModel?.id).toBe('model-1')
      expect(state.selectedAssistant).toBeNull()
    })

    it('creates a new conversation when the latest one has messages', async () => {
      useConversationStore.setState({ conversations: [conversation] })
      mockLatestMessages([message])
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleModelClick(modelItem)
      })

      expect(createConversation).toHaveBeenCalledWith('')
      expect(selectConversation).toHaveBeenCalledWith('conv-new')
      expect(selectConversation).not.toHaveBeenCalledWith('conv-1')
    })

    it('creates a new conversation when no conversations exist', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleModelClick(modelItem)
      })

      expect(invoke).not.toHaveBeenCalled()
      expect(createConversation).toHaveBeenCalledWith('')
      expect(selectConversation).toHaveBeenCalledWith('conv-new')
    })

    it('toasts when selecting the model fails', async () => {
      useConversationStore.setState({ conversations: [conversation] })
      mockLatestMessages(null)
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleModelClick(modelItem)
      })

      expect(toast.error).toHaveBeenCalledWith('failedToSelectModel', { description: 'boom' })
      expect(logger.error).toHaveBeenCalledWith('Failed to handle model click:', expect.any(Error))
      expect(useConversationStore.getState().selectedModel).toBeNull()
    })
  })

  describe('handleAssistantClick', () => {
    it('logs and does nothing when the assistant is unknown to the store', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleAssistantClick({ id: 'missing', name: 'Ghost' })
      })

      expect(logger.error).toHaveBeenCalledWith('Assistant not found:', 'missing')
      expect(selectConversation).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('selects the assistant and seeds settings from its tools and skills', async () => {
      useConversationStore.setState({ conversations: [conversation] })
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleAssistantClick(assistantItem)
      })

      expect(selectConversation).toHaveBeenCalledWith('conv-1')
      expect(initSettingsFromAssistant).toHaveBeenCalledWith('conv-1', ['tool-1'], ['skill-1'])
      const state = useConversationStore.getState()
      expect(state.selectedAssistant?.id).toBe('assistant-1')
      expect(state.selectedModel).toBeNull()
    })

    it('creates a fresh conversation when the latest one is not empty', async () => {
      useConversationStore.setState({ conversations: [conversation] })
      mockLatestMessages([message])
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleAssistantClick(assistantItem)
      })

      expect(createConversation).toHaveBeenCalledWith('')
      expect(initSettingsFromAssistant).toHaveBeenCalledWith('conv-new', ['tool-1'], ['skill-1'])
    })

    it('toasts when selecting the assistant fails', async () => {
      useConversationStore.setState({ conversations: [conversation] })
      mockLatestMessages(null)
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleAssistantClick(assistantItem)
      })

      expect(toast.error).toHaveBeenCalledWith('failedToSelectAssistant', { description: 'boom' })
      expect(useConversationStore.getState().selectedAssistant).toBeNull()
    })
  })

  describe('handleModelStarToggle', () => {
    it('flips the starred flag through updateModel', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleModelStarToggle(modelItem)
      })

      expect(updateModel).toHaveBeenCalledWith('model-1', {
        name: 'GPT-4o',
        provider_id: 'provider-1',
        model_id: 'gpt-4o',
        description: undefined,
        is_starred: true,
      })
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('unstars an already starred model', async () => {
      useModelStore.setState({ models: [{ ...model, is_starred: true }] })
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleModelStarToggle(modelItem)
      })

      expect(updateModel).toHaveBeenCalledWith(
        'model-1',
        expect.objectContaining({ is_starred: false })
      )
    })

    it('ignores unknown models and logs star failures without toasting', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleModelStarToggle({ ...modelItem, id: 'missing-model' })
      })

      expect(updateModel).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()

      updateModel.mockRejectedValue(new Error('db locked'))
      await act(async () => {
        await result.current.handleModelStarToggle(modelItem)
      })

      expect(logger.error).toHaveBeenCalledWith('Failed to toggle star:', expect.any(Error))
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('handleAssistantStarToggle', () => {
    it('flips the starred flag through updateAssistant', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleAssistantStarToggle(assistantItem)
      })

      expect(updateAssistant).toHaveBeenCalledWith('assistant-1', {
        name: 'Helper',
        system_prompt: 'assistant system prompt',
        model_id: 'model-1',
        avatar_bg: undefined,
        avatar_text: undefined,
        group_name: undefined,
        is_starred: true,
      })
    })

    it('does nothing for unknown assistants and logs failures silently', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleAssistantStarToggle({ id: 'missing', name: 'Ghost' })
      })

      expect(updateAssistant).not.toHaveBeenCalled()

      updateAssistant.mockRejectedValue(new Error('db locked'))
      await act(async () => {
        await result.current.handleAssistantStarToggle(assistantItem)
      })

      expect(logger.error).toHaveBeenCalledWith('Failed to toggle star:', expect.any(Error))
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('handleModelDelete', () => {
    it('deletes a known model', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleModelDelete(modelItem)
      })

      expect(deleteModel).toHaveBeenCalledWith('model-1')
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('logs and stops for unknown models', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleModelDelete({ ...modelItem, id: 'missing-model' })
      })

      expect(logger.error).toHaveBeenCalledWith('Model not found:', 'missing-model')
      expect(deleteModel).not.toHaveBeenCalled()
    })

    it('toasts when the delete fails', async () => {
      deleteModel.mockRejectedValue(new Error('denied'))
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleModelDelete(modelItem)
      })

      expect(toast.error).toHaveBeenCalledWith('failedToDeleteModel', { description: 'denied' })
    })
  })

  describe('handleAssistantDelete', () => {
    it('deletes a known assistant', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleAssistantDelete(assistantItem)
      })

      expect(deleteAssistant).toHaveBeenCalledWith('assistant-1')
    })

    it('logs and stops for unknown assistants', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleAssistantDelete({ id: 'missing', name: 'Ghost' })
      })

      expect(logger.error).toHaveBeenCalledWith('Assistant not found:', 'missing')
      expect(deleteAssistant).not.toHaveBeenCalled()
    })

    it('toasts when the delete fails', async () => {
      deleteAssistant.mockRejectedValue(new Error('denied'))
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleAssistantDelete(assistantItem)
      })

      expect(toast.error).toHaveBeenCalledWith('failedToDeleteAssistant', { description: 'denied' })
    })
  })

  describe('handlePromptDelete', () => {
    it('deletes a known prompt', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handlePromptDelete(promptItem)
      })

      expect(deletePrompt).toHaveBeenCalledWith('prompt-1')
    })

    it('logs and stops for unknown prompts', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handlePromptDelete({ id: 'missing', name: 'Ghost', content: 'x' })
      })

      expect(logger.error).toHaveBeenCalledWith('Prompt not found:', 'missing')
      expect(deletePrompt).not.toHaveBeenCalled()
    })

    it('toasts when the delete fails', async () => {
      deletePrompt.mockRejectedValue(new Error('denied'))
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handlePromptDelete(promptItem)
      })

      expect(toast.error).toHaveBeenCalledWith('failedToDeletePrompt', { description: 'denied' })
    })
  })

  describe('handleConversationClick', () => {
    it('selects the conversation', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleConversationClick('conv-1')
      })

      expect(selectConversation).toHaveBeenCalledWith('conv-1')
    })

    it('logs failures without toasting', async () => {
      selectConversation.mockRejectedValue(new Error('gone'))
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleConversationClick('conv-1')
      })

      expect(logger.error).toHaveBeenCalledWith('Failed to select conversation:', expect.any(Error))
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('handleNewConversation', () => {
    it('rescans skills and navigates to the latest conversation when it is empty', async () => {
      useConversationStore.setState({ conversations: [conversation] })
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleNewConversation()
      })

      expect(scanSkills).toHaveBeenCalledTimes(1)
      expect(createConversation).not.toHaveBeenCalled()
      expect(selectConversation).toHaveBeenCalledWith('conv-1')
    })

    it('creates and selects a new conversation when the latest has messages', async () => {
      useConversationStore.setState({ conversations: [conversation] })
      mockLatestMessages([message])
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleNewConversation()
      })

      expect(createConversation).toHaveBeenCalledWith('')
      expect(selectConversation).toHaveBeenCalledWith('conv-new')
    })

    it('creates a conversation when none exist yet', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleNewConversation()
      })

      expect(invoke).not.toHaveBeenCalled()
      expect(createConversation).toHaveBeenCalledWith('')
      expect(selectConversation).toHaveBeenCalledWith('conv-new')
    })

    it('toasts when creating a conversation fails', async () => {
      useConversationStore.setState({ conversations: [conversation] })
      mockLatestMessages(null)
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleNewConversation()
      })

      expect(toast.error).toHaveBeenCalledWith('failedToCreateConversation', {
        description: 'boom',
      })
    })
  })

  describe('handleGenerateTitle', () => {
    it('generates a title and persists it on the conversation', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleGenerateTitle('conv-1')
      })

      expect(invoke).toHaveBeenCalledWith('generate_conversation_title_manually', {
        conversationId: 'conv-1',
      })
      expect(updateConversation).toHaveBeenCalledWith('conv-1', 'Generated Title')
    })

    it('toasts when generation fails', async () => {
      mockLatestMessages(null)
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleGenerateTitle('conv-1')
      })

      expect(updateConversation).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('failedToGenerateTitle', { description: 'boom' })
    })
  })

  describe('handleEditTitle', () => {
    it('persists the new title', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleEditTitle('conv-1', 'Renamed')
      })

      expect(updateConversation).toHaveBeenCalledWith('conv-1', 'Renamed')
    })

    it('logs failures without toasting', async () => {
      updateConversation.mockRejectedValue(new Error('readonly'))
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleEditTitle('conv-1', 'Renamed')
      })

      expect(logger.error).toHaveBeenCalledWith('Failed to update title:', expect.any(Error))
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('handleDeleteConversation', () => {
    it('deletes the conversation', async () => {
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleDeleteConversation('conv-1')
      })

      expect(deleteConversation).toHaveBeenCalledWith('conv-1')
    })

    it('logs failures without toasting', async () => {
      deleteConversation.mockRejectedValue(new Error('denied'))
      const { result } = renderHook(() => useSidebarHandlers())

      await act(async () => {
        await result.current.handleDeleteConversation('conv-1')
      })

      expect(logger.error).toHaveBeenCalledWith('Failed to delete conversation:', expect.any(Error))
      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
