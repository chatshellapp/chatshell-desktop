import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useConversationStore } from '../conversation'
import { useModelStore } from '../modelStore'
import { useAssistantStore } from '../assistantStore'
import { useConversationSettingsStore } from '../conversationSettingsStore'
import type {
  Conversation,
  Model,
  Assistant,
  ConversationParticipant,
  ConversationSettingsResponse,
} from '@/types'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
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

const mockInvoke = vi.mocked(invoke)

const createMockConversation = (id: string, title: string): Conversation => ({
  id,
  title,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

const createMockModel = (id: string, name: string): Model => ({
  id,
  provider_id: 'provider-1',
  name,
  model_id: name.toLowerCase(),
  is_starred: false,
  is_deleted: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

const createMockAssistant = (id: string, name: string): Assistant => ({
  id,
  name,
  model_id: 'model-1',
  system_prompt: 'You are helpful',
  avatar_type: 'text',
  tool_ids: [],
  skill_ids: [],
  is_starred: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

describe('useConversationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to initial values
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
    })
  })

  describe('initial state', () => {
    it('should have empty conversations array', () => {
      const state = useConversationStore.getState()
      expect(state.conversations).toEqual([])
    })

    it('should have no current conversation initially', () => {
      const state = useConversationStore.getState()
      expect(state.currentConversation).toBeNull()
    })

    it('should not be loading initially', () => {
      const state = useConversationStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have no error initially', () => {
      const state = useConversationStore.getState()
      expect(state.error).toBeNull()
    })

    it('should have no selected model or assistant initially', () => {
      const state = useConversationStore.getState()
      expect(state.selectedModel).toBeNull()
      expect(state.selectedAssistant).toBeNull()
    })
  })

  describe('loadConversations', () => {
    it('should populate conversations on successful load', async () => {
      const mockConversations: Conversation[] = [
        createMockConversation('conv-1', 'Test Conversation 1'),
        createMockConversation('conv-2', 'Test Conversation 2'),
      ]
      mockInvoke.mockResolvedValue(mockConversations)

      await useConversationStore.getState().loadConversations()

      expect(mockInvoke).toHaveBeenCalledWith('list_conversations')
      expect(useConversationStore.getState().conversations).toEqual(mockConversations)
      expect(useConversationStore.getState().isLoading).toBe(false)
      expect(useConversationStore.getState().error).toBeNull()
    })

    it('should set error on failed load', async () => {
      const errorMessage = 'Failed to load conversations'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await useConversationStore.getState().loadConversations()

      expect(useConversationStore.getState().conversations).toEqual([])
      expect(useConversationStore.getState().isLoading).toBe(false)
      expect(useConversationStore.getState().error).toContain(errorMessage)
    })
  })

  describe('createConversation', () => {
    it('should create a new conversation and add to store', async () => {
      const newConversation = createMockConversation('new-conv', '')
      mockInvoke.mockResolvedValue(newConversation)

      const result = await useConversationStore.getState().createConversation('')

      expect(mockInvoke).toHaveBeenCalledWith('create_conversation', {
        req: { title: '' },
      })
      expect(result).toEqual(newConversation)
      expect(useConversationStore.getState().conversations).toContainEqual(newConversation)
    })

    it('should add new conversation at the beginning of the list', async () => {
      const existingConversation = createMockConversation('existing', 'Existing')
      useConversationStore.setState({ conversations: [existingConversation] })

      const newConversation = createMockConversation('new-conv', '')
      mockInvoke.mockResolvedValue(newConversation)

      await useConversationStore.getState().createConversation('')

      const conversations = useConversationStore.getState().conversations
      expect(conversations[0]).toEqual(newConversation)
      expect(conversations[1]).toEqual(existingConversation)
    })

    it('should throw and set error on failure', async () => {
      const errorMessage = 'Failed to create conversation'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await expect(useConversationStore.getState().createConversation('Test')).rejects.toThrow()

      expect(useConversationStore.getState().error).toContain(errorMessage)
    })
  })

  describe('updateConversation', () => {
    it('should update conversation title', async () => {
      const conversation = createMockConversation('conv-1', 'Old Title')
      useConversationStore.setState({ conversations: [conversation] })

      const updatedConversation = { ...conversation, title: 'New Title' }
      mockInvoke.mockResolvedValue(updatedConversation)

      const result = await useConversationStore.getState().updateConversation('conv-1', 'New Title')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation', {
        id: 'conv-1',
        title: 'New Title',
      })
      expect(result.title).toBe('New Title')
      expect(useConversationStore.getState().conversations[0].title).toBe('New Title')
    })

    it('should update currentConversation if it matches', async () => {
      const conversation = createMockConversation('conv-1', 'Old Title')
      useConversationStore.setState({
        conversations: [conversation],
        currentConversation: conversation,
      })

      const updatedConversation = { ...conversation, title: 'New Title' }
      mockInvoke.mockResolvedValue(updatedConversation)

      await useConversationStore.getState().updateConversation('conv-1', 'New Title')

      expect(useConversationStore.getState().currentConversation?.title).toBe('New Title')
    })
  })

  describe('deleteConversation', () => {
    it('should delete conversation and remove from store', async () => {
      const conversation = createMockConversation('conv-1', 'Test')
      useConversationStore.setState({ conversations: [conversation] })
      mockInvoke.mockResolvedValue(undefined)

      await useConversationStore.getState().deleteConversation('conv-1')

      expect(mockInvoke).toHaveBeenCalledWith('delete_conversation', { id: 'conv-1' })
      expect(useConversationStore.getState().conversations).toHaveLength(0)
    })

    it('should clear currentConversation if deleted', async () => {
      const conversation = createMockConversation('conv-1', 'Test')
      useConversationStore.setState({
        conversations: [conversation],
        currentConversation: conversation,
      })
      mockInvoke.mockResolvedValue(undefined)

      await useConversationStore.getState().deleteConversation('conv-1')

      expect(useConversationStore.getState().currentConversation).toBeNull()
    })
  })

  describe('setCurrentConversation', () => {
    it('should set current conversation', () => {
      const conversation = createMockConversation('conv-1', 'Test')

      useConversationStore.getState().setCurrentConversation(conversation)

      expect(useConversationStore.getState().currentConversation).toEqual(conversation)
    })

    it('should clear current conversation when set to null', () => {
      const conversation = createMockConversation('conv-1', 'Test')
      useConversationStore.setState({ currentConversation: conversation })

      useConversationStore.getState().setCurrentConversation(null)

      expect(useConversationStore.getState().currentConversation).toBeNull()
    })
  })

  describe('setSelectedModel', () => {
    it('should set selected model and clear assistant', () => {
      const model = createMockModel('model-1', 'GPT-4')

      useConversationStore.getState().setSelectedModel(model)

      const state = useConversationStore.getState()
      expect(state.selectedModel).toEqual(model)
      expect(state.selectedAssistant).toBeNull()
      expect(state.lastUsedModel).toEqual(model)
    })

    it('should not select soft-deleted model', () => {
      const deletedModel = { ...createMockModel('model-1', 'GPT-4'), is_deleted: true }

      useConversationStore.getState().setSelectedModel(deletedModel)

      const state = useConversationStore.getState()
      expect(state.selectedModel).toBeNull()
    })

    it('should clear selection when set to null', () => {
      const model = createMockModel('model-1', 'GPT-4')
      useConversationStore.setState({ selectedModel: model })

      useConversationStore.getState().setSelectedModel(null)

      expect(useConversationStore.getState().selectedModel).toBeNull()
    })
  })

  describe('setSelectedAssistant', () => {
    it('should set selected assistant and clear model', () => {
      const assistant: Assistant = {
        id: 'assistant-1',
        name: 'My Assistant',
        model_id: 'model-1',
        system_prompt: 'You are helpful',
        avatar_type: 'text',
        tool_ids: [],
        skill_ids: [],
        is_starred: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }
      const model = createMockModel('model-1', 'GPT-4')
      useConversationStore.setState({ selectedModel: model })

      useConversationStore.getState().setSelectedAssistant(assistant)

      const state = useConversationStore.getState()
      expect(state.selectedAssistant).toEqual(assistant)
      expect(state.selectedModel).toBeNull()
      expect(state.lastUsedAssistant).toEqual(assistant)
    })
  })

  describe('getCurrentModel', () => {
    it('should return selected model when set', () => {
      const model = createMockModel('model-1', 'GPT-4')
      useConversationStore.setState({ selectedModel: model })

      const currentModel = useConversationStore.getState().getCurrentModel()

      expect(currentModel).toEqual(model)
    })

    it('should return null when no model selected', () => {
      const currentModel = useConversationStore.getState().getCurrentModel()

      expect(currentModel).toBeNull()
    })
  })
})

const createMockParticipant = (
  id: string,
  participantType: string,
  participantId?: string
): ConversationParticipant => ({
  id,
  conversation_id: 'conv-1',
  participant_type: participantType,
  participant_id: participantId,
  role: 'member',
  status: 'active',
  joined_at: '2024-01-01T00:00:00Z',
})

const createBackendSettingsResponse = (conversationId: string): ConversationSettingsResponse => ({
  conversation_id: conversationId,
  use_provider_defaults: true,
  use_custom_parameters: false,
  parameter_overrides: {},
  context_message_count: null,
  selected_preset_id: null,
  system_prompt_mode: 'none',
  selected_system_prompt_id: null,
  custom_system_prompt: null,
  user_prompt_mode: 'none',
  selected_user_prompt_id: null,
  custom_user_prompt: null,
  enabled_mcp_server_ids: [],
  enabled_skill_ids: [],
  working_directory: null,
})

describe('useConversationStore participants and selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    })
    useModelStore.setState({ models: [], providers: [], isLoading: false, error: null })
    useAssistantStore.setState({
      assistants: [],
      currentAssistant: null,
      lastCreatedModelId: null,
      isLoading: false,
      error: null,
    })
    useConversationSettingsStore.setState({ settings: {}, loading: {}, error: null })
  })

  /** Route invoke() by command name so dynamic store imports resolve */
  function mockInvokeByCommand(results: Record<string, unknown>) {
    mockInvoke.mockImplementation(((cmd: string) =>
      cmd in results
        ? results[cmd]
        : Promise.reject(new Error(`unexpected command ${cmd}`))) as never)
  }

  function selectMocks(conversationId = 'conv-1', participants: ConversationParticipant[] = []) {
    mockInvokeByCommand({
      get_conversation: createMockConversation(conversationId, 'Selected'),
      list_conversation_participants: participants,
      get_conversation_settings: createBackendSettingsResponse(conversationId),
      reset_conversation_tools_to_global: createBackendSettingsResponse(conversationId),
    })
  }

  describe('selectConversation', () => {
    it('selects the model of the last joined model participant', async () => {
      const model = createMockModel('model-1', 'GPT-4')
      useModelStore.setState({ models: [model] })
      selectMocks('conv-1', [
        createMockParticipant('p-1', 'model', 'model-1'),
        createMockParticipant('p-2', 'model', 'model-1'),
      ])

      await useConversationStore.getState().selectConversation('conv-1')

      const state = useConversationStore.getState()
      expect(state.currentConversation?.id).toBe('conv-1')
      expect(state.currentParticipants).toHaveLength(2)
      expect(state.selectedModel?.id).toBe('model-1')
      expect(state.selectedAssistant).toBeNull()
    })

    it('selects an assistant participant from the assistant store', async () => {
      const assistant = createMockAssistant('assistant-1', 'Helper')
      useAssistantStore.setState({ assistants: [assistant] })
      selectMocks('conv-1', [createMockParticipant('p-1', 'assistant', 'assistant-1')])

      await useConversationStore.getState().selectConversation('conv-1')

      expect(useConversationStore.getState().selectedAssistant?.id).toBe('assistant-1')
      expect(useConversationStore.getState().selectedModel).toBeNull()
    })

    it('ignores a participant whose model is soft-deleted', async () => {
      const deletedModel = { ...createMockModel('model-1', 'GPT-4'), is_deleted: true }
      useModelStore.setState({ models: [deletedModel] })
      selectMocks('conv-1', [createMockParticipant('p-1', 'model', 'model-1')])

      await useConversationStore.getState().selectConversation('conv-1')

      const state = useConversationStore.getState()
      expect(state.selectedModel).toBeNull()
      expect(state.selectedAssistant).toBeNull()
    })

    it('falls back to the last used model when the conversation has no participants', async () => {
      const lastUsed = createMockModel('model-9', 'Last Used')
      useConversationStore.setState({ lastUsedModel: lastUsed })
      selectMocks('conv-1', [])

      await useConversationStore.getState().selectConversation('conv-1')

      expect(useConversationStore.getState().selectedModel?.id).toBe('model-9')
    })

    it('falls back to the last used assistant when there is no last used model', async () => {
      const lastUsedAssistant = createMockAssistant('assistant-9', 'Old Helper')
      useConversationStore.setState({ lastUsedAssistant: lastUsedAssistant })
      selectMocks('conv-1', [])

      await useConversationStore.getState().selectConversation('conv-1')

      expect(useConversationStore.getState().selectedAssistant?.id).toBe('assistant-9')
    })

    it('clears the selection and resets conversation tools when nothing is available', async () => {
      selectMocks('conv-1', [])

      await useConversationStore.getState().selectConversation('conv-1')

      const state = useConversationStore.getState()
      expect(state.selectedModel).toBeNull()
      expect(state.selectedAssistant).toBeNull()
      expect(mockInvoke).toHaveBeenCalledWith(
        'reset_conversation_tools_to_global',
        expect.objectContaining({ conversationId: 'conv-1' })
      )
    })

    it('clears the current conversation when the backend returns null', async () => {
      const conv = createMockConversation('conv-1', 'Old')
      useConversationStore.setState({ currentConversation: conv, currentParticipants: [] })
      mockInvokeByCommand({ get_conversation: null })

      await useConversationStore.getState().selectConversation('missing')

      expect(useConversationStore.getState().currentConversation).toBeNull()
      expect(useConversationStore.getState().currentParticipants).toEqual([])
    })

    it('records the error when loading the conversation fails', async () => {
      mockInvoke.mockRejectedValue(new Error('db unavailable'))

      await useConversationStore.getState().selectConversation('conv-1')

      expect(useConversationStore.getState().error).toContain('db unavailable')
      expect(useConversationStore.getState().currentConversation).toBeNull()
    })
  })

  describe('loadParticipants', () => {
    it('stores the participants of the current conversation', async () => {
      const participants = [createMockParticipant('p-1', 'model', 'model-1')]
      mockInvoke.mockResolvedValue(participants)

      await useConversationStore.getState().loadParticipants('conv-1')

      expect(mockInvoke).toHaveBeenCalledWith('list_conversation_participants', {
        conversationId: 'conv-1',
      })
      expect(useConversationStore.getState().currentParticipants).toEqual(participants)
    })

    it('sets the error state on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('no such conversation'))

      await useConversationStore.getState().loadParticipants('conv-1')

      expect(useConversationStore.getState().error).toContain('no such conversation')
    })
  })

  describe('addParticipant', () => {
    it('appends the created participant', async () => {
      const participant = createMockParticipant('p-1', 'model', 'model-1')
      mockInvoke.mockResolvedValue(participant)

      await useConversationStore.getState().addParticipant('conv-1', 'model', 'model-1', 'GPT-4')

      expect(mockInvoke).toHaveBeenCalledWith('add_conversation_participant', {
        req: {
          conversation_id: 'conv-1',
          participant_type: 'model',
          participant_id: 'model-1',
          display_name: 'GPT-4',
        },
      })
      expect(useConversationStore.getState().currentParticipants).toEqual([participant])
    })

    it('throws and records the error on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('insert failed'))

      await expect(
        useConversationStore.getState().addParticipant('conv-1', 'model')
      ).rejects.toThrow('insert failed')

      expect(useConversationStore.getState().error).toContain('insert failed')
    })
  })

  describe('removeParticipant', () => {
    it('drops the participant from the list', async () => {
      useConversationStore.setState({
        currentParticipants: [
          createMockParticipant('p-1', 'model', 'model-1'),
          createMockParticipant('p-2', 'assistant', 'assistant-1'),
        ],
      })
      mockInvoke.mockResolvedValue(undefined)

      await useConversationStore.getState().removeParticipant('p-1')

      expect(mockInvoke).toHaveBeenCalledWith('remove_conversation_participant', { id: 'p-1' })
      expect(useConversationStore.getState().currentParticipants.map((p) => p.id)).toEqual(['p-2'])
    })

    it('throws and records the error on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('delete failed'))

      await expect(useConversationStore.getState().removeParticipant('p-1')).rejects.toThrow(
        'delete failed'
      )

      expect(useConversationStore.getState().error).toContain('delete failed')
    })
  })

  describe('setPendingInput', () => {
    it('stores and clears the queued input', () => {
      useConversationStore.getState().setPendingInput('draft question')
      expect(useConversationStore.getState().pendingInput).toBe('draft question')

      useConversationStore.getState().setPendingInput(null)
      expect(useConversationStore.getState().pendingInput).toBeNull()
    })
  })

  describe('bumpConversation', () => {
    it('moves an inactive conversation to the top and stamps it', () => {
      const top = createMockConversation('conv-top', 'Top')
      const stale = createMockConversation('conv-stale', 'Stale')
      useConversationStore.setState({ conversations: [top, stale] })

      useConversationStore.getState().bumpConversation('conv-stale', 'newest message')

      const conversations = useConversationStore.getState().conversations
      expect(conversations.map((c) => c.id)).toEqual(['conv-stale', 'conv-top'])
      expect(conversations[0].last_message).toBe('newest message')
      expect(conversations[0].updated_at).not.toBe(stale.updated_at)
    })

    it('leaves the newest conversation in place', () => {
      const top = createMockConversation('conv-top', 'Top')
      const other = createMockConversation('conv-other', 'Other')
      useConversationStore.setState({ conversations: [top, other] })

      useConversationStore.getState().bumpConversation('conv-top', 'message')

      expect(useConversationStore.getState().conversations.map((c) => c.id)).toEqual([
        'conv-top',
        'conv-other',
      ])
    })

    it('does nothing for an unknown conversation id', () => {
      const conv = createMockConversation('conv-1', 'Only')
      useConversationStore.setState({ conversations: [conv] })

      useConversationStore.getState().bumpConversation('missing')

      expect(useConversationStore.getState().conversations).toEqual([conv])
    })
  })
})
