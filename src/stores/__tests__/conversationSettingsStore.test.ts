import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'
import { useConversationSettingsStore } from '../conversationSettingsStore'
import { useMcpStore } from '../mcpStore'
import { useSkillStore } from '../skillStore'
import type { ConversationSettings, ConversationSettingsResponse, Skill, Tool } from '@/types'
import { createDefaultConversationSettings } from '@/types'

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

const createMcpServer = (id: string, isEnabled: boolean): Tool => ({
  id,
  name: `MCP ${id}`,
  type: 'mcp',
  endpoint: `http://${id}.local`,
  is_enabled: isEnabled,
  auth_token: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

const createSkill = (id: string, isEnabled: boolean): Skill => ({
  id,
  name: `Skill ${id}`,
  source: 'user',
  path: `/skills/${id}`,
  required_tool_ids: [],
  allow_model_invocation: true,
  allow_user_invocation: true,
  is_enabled: isEnabled,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

const backendResponse = (
  overrides: Partial<ConversationSettingsResponse> = {}
): ConversationSettingsResponse => ({
  conversation_id: 'conv-1',
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
  ...overrides,
})

const seedSettings = (conversationId: string, overrides: Partial<ConversationSettings> = {}) => {
  const settings = { ...createDefaultConversationSettings(conversationId), ...overrides }
  useConversationSettingsStore.setState({ settings: { [conversationId]: settings } })
  return settings
}

describe('useConversationSettingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConversationSettingsStore.setState({ settings: {}, loading: {}, error: null })
    useMcpStore.setState({ servers: [], isLoading: false, error: null })
    useSkillStore.setState({
      skills: [],
      sources: [],
      isLoading: false,
      error: null,
      hasScanned: false,
    })
  })

  describe('initial state', () => {
    it('starts with empty caches and no error', () => {
      const state = useConversationSettingsStore.getState()
      expect(state.settings).toEqual({})
      expect(state.loading).toEqual({})
      expect(state.error).toBeNull()
    })
  })

  describe('loadSettings', () => {
    it('fetches backend settings and caches the mapped result', async () => {
      const response = backendResponse({
        use_custom_parameters: true,
        parameter_overrides: { temperature: 0.7, max_tokens: 2048 },
        context_message_count: 10,
        system_prompt_mode: 'custom',
        custom_system_prompt: 'Be brief',
        enabled_mcp_server_ids: ['s1'],
        enabled_skill_ids: ['k1'],
        working_directory: '/tmp/work',
      })
      mockInvoke.mockResolvedValue(response)

      const result = await useConversationSettingsStore.getState().loadSettings('conv-1')

      expect(mockInvoke).toHaveBeenCalledWith('get_conversation_settings', {
        conversationId: 'conv-1',
      })
      expect(result).toEqual({
        conversationId: 'conv-1',
        useProviderDefaults: true,
        useCustomParameters: true,
        parameterOverrides: { temperature: 0.7, max_tokens: 2048 },
        contextMessageCount: 10,
        selectedPresetId: null,
        systemPromptMode: 'custom',
        selectedSystemPromptId: null,
        customSystemPrompt: 'Be brief',
        userPromptMode: 'none',
        selectedUserPromptId: null,
        customUserPrompt: null,
        enabledMcpServerIds: ['s1'],
        enabledSkillIds: ['k1'],
        workingDirectory: '/tmp/work',
      })
      const state = useConversationSettingsStore.getState()
      expect(state.settings['conv-1']).toEqual(result)
      expect(state.loading['conv-1']).toBe(false)
      expect(state.error).toBeNull()
    })

    it('falls back to defaults inherited from globally enabled tools and skills on failure', async () => {
      useMcpStore.setState({
        servers: [createMcpServer('on', true), createMcpServer('off', false)],
      })
      useSkillStore.setState({
        skills: [createSkill('sk-on', true), createSkill('sk-off', false)],
      })
      mockInvoke.mockRejectedValue(new Error('db offline'))

      const result = await useConversationSettingsStore.getState().loadSettings('conv-1')

      expect(result).toEqual(createDefaultConversationSettings('conv-1', ['on'], ['sk-on']))
      const state = useConversationSettingsStore.getState()
      expect(state.settings['conv-1']).toEqual(result)
      expect(state.error).toContain('db offline')
      expect(state.loading['conv-1']).toBe(false)
    })

    it('returns the cached settings without invoking while a load is in flight', async () => {
      const cached = seedSettings('conv-1', { contextMessageCount: 7 })
      useConversationSettingsStore.setState({ loading: { 'conv-1': true } })

      const result = await useConversationSettingsStore.getState().loadSettings('conv-1')

      expect(result).toEqual(cached)
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('returns fresh defaults without invoking when in flight and nothing is cached', async () => {
      useConversationSettingsStore.setState({ loading: { 'conv-1': true } })

      const result = await useConversationSettingsStore.getState().loadSettings('conv-1')

      expect(result).toEqual(createDefaultConversationSettings('conv-1'))
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })

  describe('getSettings', () => {
    it('returns cached settings for a loaded conversation', () => {
      const cached = seedSettings('conv-1', { workingDirectory: '/x' })

      expect(useConversationSettingsStore.getState().getSettings('conv-1')).toEqual(cached)
    })

    it('returns undefined for an unknown conversation', () => {
      expect(useConversationSettingsStore.getState().getSettings('missing')).toBeUndefined()
    })
  })

  describe('updateSettings', () => {
    it('sends a snake_case partial request and replaces the cache with the response', async () => {
      mockInvoke.mockResolvedValue(backendResponse({ context_message_count: 5 }))

      await useConversationSettingsStore.getState().updateSettings('conv-1', {
        contextMessageCount: 5,
        systemPromptMode: 'existing',
        selectedSystemPromptId: 'p1',
      })

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          context_message_count: 5,
          system_prompt_mode: 'existing',
          selected_system_prompt_id: 'p1',
        },
      })
      expect(useConversationSettingsStore.getState().settings['conv-1']?.contextMessageCount).toBe(
        5
      )
    })
  })

  describe('setUseProviderDefaults', () => {
    it('clears custom parameters and the preset when enabling provider defaults', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setUseProviderDefaults('conv-1', true)

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          use_provider_defaults: true,
          use_custom_parameters: false,
          selected_preset_id: null,
        },
      })
    })

    it('only sends the flag itself when disabling provider defaults', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setUseProviderDefaults('conv-1', false)

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { use_provider_defaults: false },
      })
    })
  })

  describe('setParameterOverrides', () => {
    it('merges new overrides into the cached ones', async () => {
      seedSettings('conv-1', { parameterOverrides: { temperature: 0.5 } })
      mockInvoke.mockResolvedValue(
        backendResponse({ parameter_overrides: { temperature: 0.5, max_tokens: 128 } })
      )

      await useConversationSettingsStore.getState().setParameterOverrides('conv-1', {
        max_tokens: 128,
      })

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { parameter_overrides: { temperature: 0.5, max_tokens: 128 } },
      })
      expect(
        useConversationSettingsStore.getState().settings['conv-1']?.parameterOverrides
      ).toEqual({ temperature: 0.5, max_tokens: 128 })
    })
  })

  describe('setUseCustomParameters', () => {
    it('clears the preset and provider defaults when enabling custom parameters', async () => {
      mockInvoke.mockResolvedValue(backendResponse({ use_custom_parameters: true }))

      await useConversationSettingsStore.getState().setUseCustomParameters('conv-1', true)

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          use_custom_parameters: true,
          selected_preset_id: null,
          use_provider_defaults: false,
        },
      })
    })

    it('only sends the flag itself when disabling custom parameters', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setUseCustomParameters('conv-1', false)

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { use_custom_parameters: false },
      })
    })
  })

  describe('setSelectedPresetId', () => {
    it('clears custom and provider defaults when selecting a preset', async () => {
      mockInvoke.mockResolvedValue(backendResponse({ selected_preset_id: 'preset-9' }))

      await useConversationSettingsStore.getState().setSelectedPresetId('conv-1', 'preset-9')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          selected_preset_id: 'preset-9',
          use_custom_parameters: false,
          use_provider_defaults: false,
        },
      })
    })

    it('sends a null preset without touching other flags', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setSelectedPresetId('conv-1', null)

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { selected_preset_id: null },
      })
    })
  })

  describe('setContextMessageCount', () => {
    it('updates the context message count', async () => {
      mockInvoke.mockResolvedValue(backendResponse({ context_message_count: 20 }))

      await useConversationSettingsStore.getState().setContextMessageCount('conv-1', 20)

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { context_message_count: 20 },
      })
      expect(useConversationSettingsStore.getState().settings['conv-1']?.contextMessageCount).toBe(
        20
      )
    })

    it('supports resetting to unlimited with null', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setContextMessageCount('conv-1', null)

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { context_message_count: null },
      })
    })
  })

  describe('system prompt setters', () => {
    it('setSystemPromptMode clears selection and content when switching to none', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setSystemPromptMode('conv-1', 'none')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          system_prompt_mode: 'none',
          selected_system_prompt_id: null,
          custom_system_prompt: null,
        },
      })
    })

    it('setSystemPromptMode clears only the selection when switching to custom', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setSystemPromptMode('conv-1', 'custom')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { system_prompt_mode: 'custom', selected_system_prompt_id: null },
      })
    })

    it('setSystemPromptMode sends only the mode when switching to existing', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setSystemPromptMode('conv-1', 'existing')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { system_prompt_mode: 'existing' },
      })
    })

    it('setSelectedSystemPromptId updates the selected prompt', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setSelectedSystemPromptId('conv-1', 'p2')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { selected_system_prompt_id: 'p2' },
      })
    })

    it('setCustomSystemPrompt updates the custom content', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setCustomSystemPrompt('conv-1', 'You are terse')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { custom_system_prompt: 'You are terse' },
      })
    })

    it('setSystemPrompt resets every field for mode none', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setSystemPrompt('conv-1', 'none')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          system_prompt_mode: 'none',
          selected_system_prompt_id: null,
          custom_system_prompt: null,
        },
      })
    })

    it('setSystemPrompt selects an existing prompt and clears custom content', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setSystemPrompt('conv-1', 'existing', 'p7')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          system_prompt_mode: 'existing',
          selected_system_prompt_id: 'p7',
          custom_system_prompt: null,
        },
      })
    })

    it('setSystemPrompt treats a missing existing prompt id as null', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setSystemPrompt('conv-1', 'existing')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          system_prompt_mode: 'existing',
          selected_system_prompt_id: null,
          custom_system_prompt: null,
        },
      })
    })

    it('setSystemPrompt stores custom content and clears the selection', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore
        .getState()
        .setSystemPrompt('conv-1', 'custom', undefined, 'Answer in haiku')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          system_prompt_mode: 'custom',
          selected_system_prompt_id: null,
          custom_system_prompt: 'Answer in haiku',
        },
      })
    })
  })

  describe('user prompt setters', () => {
    it('setUserPromptMode clears selection and content when switching to none', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setUserPromptMode('conv-1', 'none')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          user_prompt_mode: 'none',
          selected_user_prompt_id: null,
          custom_user_prompt: null,
        },
      })
    })

    it('setUserPromptMode clears only the selection when switching to custom', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setUserPromptMode('conv-1', 'custom')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { user_prompt_mode: 'custom', selected_user_prompt_id: null },
      })
    })

    it('setUserPromptMode sends only the mode when switching to existing', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setUserPromptMode('conv-1', 'existing')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { user_prompt_mode: 'existing' },
      })
    })

    it('setSelectedUserPromptId updates the selected prompt', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setSelectedUserPromptId('conv-1', 'up1')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { selected_user_prompt_id: 'up1' },
      })
    })

    it('setCustomUserPrompt updates the custom content', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setCustomUserPrompt('conv-1', 'Translate this')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { custom_user_prompt: 'Translate this' },
      })
    })

    it('setUserPrompt resets every field for mode none', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setUserPrompt('conv-1', 'none')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          user_prompt_mode: 'none',
          selected_user_prompt_id: null,
          custom_user_prompt: null,
        },
      })
    })

    it('setUserPrompt selects an existing prompt', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setUserPrompt('conv-1', 'existing', 'up2')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          user_prompt_mode: 'existing',
          selected_user_prompt_id: 'up2',
          custom_user_prompt: null,
        },
      })
    })

    it('setUserPrompt stores custom content', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore
        .getState()
        .setUserPrompt('conv-1', 'custom', undefined, 'Keep it short')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: {
          user_prompt_mode: 'custom',
          selected_user_prompt_id: null,
          custom_user_prompt: 'Keep it short',
        },
      })
    })
  })

  describe('resetSettings', () => {
    it('deletes backend settings and restores inherited defaults in the cache', async () => {
      useMcpStore.setState({ servers: [createMcpServer('global-on', true)] })
      seedSettings('conv-1', { contextMessageCount: 42, workingDirectory: '/old' })
      mockInvoke.mockResolvedValue(undefined)

      await useConversationSettingsStore.getState().resetSettings('conv-1')

      expect(mockInvoke).toHaveBeenCalledWith('delete_conversation_settings', {
        conversationId: 'conv-1',
      })
      expect(useConversationSettingsStore.getState().settings['conv-1']).toEqual(
        createDefaultConversationSettings('conv-1', ['global-on'])
      )
    })
  })

  describe('removeSettings', () => {
    it('drops cached settings and loading flags only for the removed conversation', () => {
      seedSettings('conv-1')
      seedSettings('conv-2')
      useConversationSettingsStore.setState({ loading: { 'conv-1': true, 'conv-2': false } })

      useConversationSettingsStore.getState().removeSettings('conv-1')

      const state = useConversationSettingsStore.getState()
      expect(state.settings['conv-1']).toBeUndefined()
      expect(state.loading['conv-1']).toBeUndefined()
      expect(state.settings['conv-2']).toBeDefined()
      expect(state.loading['conv-2']).toBe(false)
    })
  })

  describe('setEnabledMcpServerIds', () => {
    it('persists the enabled server list and caches the response', async () => {
      mockInvoke.mockResolvedValue(backendResponse({ enabled_mcp_server_ids: ['s1', 's2'] }))

      await useConversationSettingsStore.getState().setEnabledMcpServerIds('conv-1', ['s1', 's2'])

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { enabled_mcp_server_ids: ['s1', 's2'] },
      })
      expect(
        useConversationSettingsStore.getState().settings['conv-1']?.enabledMcpServerIds
      ).toEqual(['s1', 's2'])
    })
  })

  describe('setEnabledSkillIds', () => {
    it('persists the enabled skill list and caches the response', async () => {
      mockInvoke.mockResolvedValue(backendResponse({ enabled_skill_ids: ['k1'] }))

      await useConversationSettingsStore.getState().setEnabledSkillIds('conv-1', ['k1'])

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { enabled_skill_ids: ['k1'] },
      })
      expect(useConversationSettingsStore.getState().settings['conv-1']?.enabledSkillIds).toEqual([
        'k1',
      ])
    })
  })

  describe('initSettingsFromAssistant', () => {
    it('applies tool and skill ids together in one request', async () => {
      mockInvoke.mockResolvedValue(
        backendResponse({ enabled_mcp_server_ids: ['t1'], enabled_skill_ids: ['k1'] })
      )

      await useConversationSettingsStore
        .getState()
        .initSettingsFromAssistant('conv-1', ['t1'], ['k1'])

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { enabled_mcp_server_ids: ['t1'], enabled_skill_ids: ['k1'] },
      })
      const settings = useConversationSettingsStore.getState().settings['conv-1']
      expect(settings?.enabledMcpServerIds).toEqual(['t1'])
      expect(settings?.enabledSkillIds).toEqual(['k1'])
    })
  })

  describe('resetToolsAndSkillsToGlobal', () => {
    it('asks the backend to reset and caches the returned globals', async () => {
      mockInvoke.mockResolvedValue(
        backendResponse({ enabled_mcp_server_ids: ['g1'], enabled_skill_ids: ['g2'] })
      )

      await useConversationSettingsStore.getState().resetToolsAndSkillsToGlobal('conv-1')

      expect(mockInvoke).toHaveBeenCalledWith('reset_conversation_tools_to_global', {
        conversationId: 'conv-1',
      })
      const settings = useConversationSettingsStore.getState().settings['conv-1']
      expect(settings?.enabledMcpServerIds).toEqual(['g1'])
      expect(settings?.enabledSkillIds).toEqual(['g2'])
    })
  })

  describe('setWorkingDirectory', () => {
    it('persists a working directory', async () => {
      mockInvoke.mockResolvedValue(backendResponse({ working_directory: '/projects/x' }))

      await useConversationSettingsStore.getState().setWorkingDirectory('conv-1', '/projects/x')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { working_directory: '/projects/x' },
      })
      expect(useConversationSettingsStore.getState().settings['conv-1']?.workingDirectory).toBe(
        '/projects/x'
      )
    })

    it('persists a null working directory to fall back to the home directory', async () => {
      mockInvoke.mockResolvedValue(backendResponse())

      await useConversationSettingsStore.getState().setWorkingDirectory('conv-1', null)

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation_settings', {
        conversationId: 'conv-1',
        req: { working_directory: null },
      })
    })
  })

  describe('backend update failures', () => {
    it('swallows errors, logs them, and leaves the cached settings untouched', async () => {
      const untouched = seedSettings('conv-1', { contextMessageCount: 3 })
      mockInvoke.mockRejectedValue(new Error('backend down'))

      const store = useConversationSettingsStore.getState()
      await expect(
        store.updateSettings('conv-1', { contextMessageCount: 9 })
      ).resolves.toBeUndefined()
      await store.setUseProviderDefaults('conv-1', true)
      await store.setParameterOverrides('conv-1', { temperature: 1 })
      await store.setUseCustomParameters('conv-1', true)
      await store.setSelectedPresetId('conv-1', 'p')
      await store.setContextMessageCount('conv-1', 10)
      await store.setSystemPromptMode('conv-1', 'none')
      await store.setSelectedSystemPromptId('conv-1', 'p')
      await store.setCustomSystemPrompt('conv-1', 'c')
      await store.setSystemPrompt('conv-1', 'none')
      await store.setUserPromptMode('conv-1', 'none')
      await store.setSelectedUserPromptId('conv-1', 'p')
      await store.setCustomUserPrompt('conv-1', 'c')
      await store.setUserPrompt('conv-1', 'none')
      await store.setEnabledMcpServerIds('conv-1', ['s'])
      await store.setEnabledSkillIds('conv-1', ['k'])
      await store.initSettingsFromAssistant('conv-1', ['s'], ['k'])
      await store.resetToolsAndSkillsToGlobal('conv-1')
      await store.setWorkingDirectory('conv-1', '/x')
      await store.resetSettings('conv-1')

      expect(useConversationSettingsStore.getState().settings['conv-1']).toEqual(untouched)
      expect(logger.error).toHaveBeenCalled()
    })
  })
})
