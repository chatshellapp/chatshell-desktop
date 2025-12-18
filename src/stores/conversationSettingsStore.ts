import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type {
  ConversationSettings,
  ConversationSettingsResponse,
  PromptMode,
  ModelParameterOverrides,
  UpdateConversationSettingsRequest,
} from '@/types'
import { fromBackendSettings, toBackendRequest, createDefaultConversationSettings } from '@/types'
import { logger } from '@/lib/logger'

interface ConversationSettingsState {
  // Cached settings per conversation (conversationId -> settings)
  settings: Record<string, ConversationSettings>
  // Loading state per conversation
  loading: Record<string, boolean>
  // Error state
  error: string | null
}

interface ConversationSettingsActions {
  // Load settings for a conversation from database
  loadSettings: (conversationId: string) => Promise<ConversationSettings>

  // Get cached settings for a conversation (returns default if not loaded)
  getSettings: (conversationId: string) => ConversationSettings | undefined

  // Generic update method for atomic updates of multiple fields
  updateSettings: (
    conversationId: string,
    updates: UpdateConversationSettingsRequest
  ) => Promise<void>

  // Use provider defaults (no parameters sent)
  setUseProviderDefaults: (conversationId: string, useDefaults: boolean) => Promise<void>

  // Update parameter overrides
  setParameterOverrides: (conversationId: string, overrides: ModelParameterOverrides) => Promise<void>

  // Toggle between custom and preset parameters
  setUseCustomParameters: (conversationId: string, useCustom: boolean) => Promise<void>

  // Set selected preset ID
  setSelectedPresetId: (conversationId: string, presetId: string | null) => Promise<void>

  // Set context message count
  setContextMessageCount: (conversationId: string, count: number | null) => Promise<void>

  // System prompt settings
  setSystemPromptMode: (conversationId: string, mode: PromptMode) => Promise<void>
  setSelectedSystemPromptId: (conversationId: string, promptId: string | null) => Promise<void>
  setCustomSystemPrompt: (conversationId: string, content: string) => Promise<void>

  // Atomic system prompt update (mode + id/content together)
  setSystemPrompt: (
    conversationId: string,
    mode: PromptMode,
    promptId?: string | null,
    customContent?: string | null
  ) => Promise<void>

  // User prompt settings
  setUserPromptMode: (conversationId: string, mode: PromptMode) => Promise<void>
  setSelectedUserPromptId: (conversationId: string, promptId: string | null) => Promise<void>
  setCustomUserPrompt: (conversationId: string, content: string) => Promise<void>

  // Atomic user prompt update (mode + id/content together)
  setUserPrompt: (
    conversationId: string,
    mode: PromptMode,
    promptId?: string | null,
    customContent?: string | null
  ) => Promise<void>

  // Reset settings to default
  resetSettings: (conversationId: string) => Promise<void>

  // Remove settings from cache when conversation is deleted
  removeSettings: (conversationId: string) => void
}

type ConversationSettingsStore = ConversationSettingsState & ConversationSettingsActions

// Helper to update settings in the backend
async function updateSettingsInBackend(
  conversationId: string,
  req: UpdateConversationSettingsRequest
): Promise<ConversationSettingsResponse> {
  return await invoke<ConversationSettingsResponse>('update_conversation_settings', {
    conversationId,
    req: toBackendRequest(req),
  })
}

export const useConversationSettingsStore = create<ConversationSettingsStore>()(
  immer((set, get) => ({
    settings: {},
    loading: {},
    error: null,

    loadSettings: async (conversationId: string) => {
      // Check if already loading
      if (get().loading[conversationId]) {
        // Return cached or default
        return get().settings[conversationId] || createDefaultConversationSettings(conversationId)
      }

      set((draft) => {
        draft.loading[conversationId] = true
        draft.error = null
      })

      try {
        const response = await invoke<ConversationSettingsResponse>('get_conversation_settings', {
          conversationId,
        })
        const settings = fromBackendSettings(response)

        set((draft) => {
          draft.settings[conversationId] = settings
          draft.loading[conversationId] = false
        })

        return settings
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to load settings:', error)
        // Store default settings on error so UI still works
        const defaultSettings = createDefaultConversationSettings(conversationId)
        set((draft) => {
          draft.settings[conversationId] = defaultSettings
          draft.error = String(error)
          draft.loading[conversationId] = false
        })
        return defaultSettings
      }
    },

    getSettings: (conversationId: string) => {
      return get().settings[conversationId]
    },

    updateSettings: async (
      conversationId: string,
      updates: UpdateConversationSettingsRequest
    ) => {
      try {
        const response = await updateSettingsInBackend(conversationId, updates)
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update settings:', error)
      }
    },

    setUseProviderDefaults: async (conversationId: string, useDefaults: boolean) => {
      try {
        const req: UpdateConversationSettingsRequest = {
          useProviderDefaults: useDefaults,
        }
        if (useDefaults) {
          // Clear other parameter settings
          req.useCustomParameters = false
          req.selectedPresetId = null
        }
        const response = await updateSettingsInBackend(conversationId, req)
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update useProviderDefaults:', error)
      }
    },

    setParameterOverrides: async (conversationId: string, overrides: ModelParameterOverrides) => {
      try {
        const existing = get().settings[conversationId]
        const merged = {
          ...existing?.parameterOverrides,
          ...overrides,
        }
        const response = await updateSettingsInBackend(conversationId, {
          parameterOverrides: merged,
        })
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update parameterOverrides:', error)
      }
    },

    setUseCustomParameters: async (conversationId: string, useCustom: boolean) => {
      try {
        const req: UpdateConversationSettingsRequest = {
          useCustomParameters: useCustom,
        }
        if (useCustom) {
          req.selectedPresetId = null
          req.useProviderDefaults = false
        }
        const response = await updateSettingsInBackend(conversationId, req)
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update useCustomParameters:', error)
      }
    },

    setSelectedPresetId: async (conversationId: string, presetId: string | null) => {
      try {
        const req: UpdateConversationSettingsRequest = {
          selectedPresetId: presetId,
        }
        if (presetId !== null) {
          req.useCustomParameters = false
          req.useProviderDefaults = false
        }
        const response = await updateSettingsInBackend(conversationId, req)
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update selectedPresetId:', error)
      }
    },

    setContextMessageCount: async (conversationId: string, count: number | null) => {
      try {
        const response = await updateSettingsInBackend(conversationId, {
          contextMessageCount: count,
        })
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update contextMessageCount:', error)
      }
    },

    setSystemPromptMode: async (conversationId: string, mode: PromptMode) => {
      try {
        const req: UpdateConversationSettingsRequest = {
          systemPromptMode: mode,
        }
        // Clear selection when switching to 'none' or 'custom'
        if (mode === 'none' || mode === 'custom') {
          req.selectedSystemPromptId = null
        }
        if (mode === 'none') {
          req.customSystemPrompt = null
        }
        const response = await updateSettingsInBackend(conversationId, req)
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update systemPromptMode:', error)
      }
    },

    setSelectedSystemPromptId: async (conversationId: string, promptId: string | null) => {
      try {
        const response = await updateSettingsInBackend(conversationId, {
          selectedSystemPromptId: promptId,
        })
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update selectedSystemPromptId:', error)
      }
    },

    setCustomSystemPrompt: async (conversationId: string, content: string) => {
      try {
        const response = await updateSettingsInBackend(conversationId, {
          customSystemPrompt: content,
        })
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update customSystemPrompt:', error)
      }
    },

    setSystemPrompt: async (
      conversationId: string,
      mode: PromptMode,
      promptId?: string | null,
      customContent?: string | null
    ) => {
      try {
        const req: UpdateConversationSettingsRequest = {
          systemPromptMode: mode,
        }
        // Set appropriate fields based on mode
        if (mode === 'none') {
          req.selectedSystemPromptId = null
          req.customSystemPrompt = null
        } else if (mode === 'existing') {
          req.selectedSystemPromptId = promptId ?? null
          req.customSystemPrompt = null
        } else if (mode === 'custom') {
          req.selectedSystemPromptId = null
          req.customSystemPrompt = customContent ?? null
        }
        const response = await updateSettingsInBackend(conversationId, req)
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update system prompt:', error)
      }
    },

    setUserPromptMode: async (conversationId: string, mode: PromptMode) => {
      try {
        const req: UpdateConversationSettingsRequest = {
          userPromptMode: mode,
        }
        // Clear selection when switching to 'none' or 'custom'
        if (mode === 'none' || mode === 'custom') {
          req.selectedUserPromptId = null
        }
        if (mode === 'none') {
          req.customUserPrompt = null
        }
        const response = await updateSettingsInBackend(conversationId, req)
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update userPromptMode:', error)
      }
    },

    setSelectedUserPromptId: async (conversationId: string, promptId: string | null) => {
      try {
        const response = await updateSettingsInBackend(conversationId, {
          selectedUserPromptId: promptId,
        })
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update selectedUserPromptId:', error)
      }
    },

    setCustomUserPrompt: async (conversationId: string, content: string) => {
      try {
        const response = await updateSettingsInBackend(conversationId, {
          customUserPrompt: content,
        })
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update customUserPrompt:', error)
      }
    },

    setUserPrompt: async (
      conversationId: string,
      mode: PromptMode,
      promptId?: string | null,
      customContent?: string | null
    ) => {
      try {
        const req: UpdateConversationSettingsRequest = {
          userPromptMode: mode,
        }
        // Set appropriate fields based on mode
        if (mode === 'none') {
          req.selectedUserPromptId = null
          req.customUserPrompt = null
        } else if (mode === 'existing') {
          req.selectedUserPromptId = promptId ?? null
          req.customUserPrompt = null
        } else if (mode === 'custom') {
          req.selectedUserPromptId = null
          req.customUserPrompt = customContent ?? null
        }
        const response = await updateSettingsInBackend(conversationId, req)
        set((draft) => {
          draft.settings[conversationId] = fromBackendSettings(response)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to update user prompt:', error)
      }
    },

    resetSettings: async (conversationId: string) => {
      try {
        await invoke('delete_conversation_settings', { conversationId })
        set((draft) => {
          draft.settings[conversationId] = createDefaultConversationSettings(conversationId)
        })
      } catch (error) {
        logger.error('[conversationSettingsStore] Failed to reset settings:', error)
      }
    },

    removeSettings: (conversationId: string) => {
      set((draft) => {
        delete draft.settings[conversationId]
        delete draft.loading[conversationId]
      })
    },
  }))
)
