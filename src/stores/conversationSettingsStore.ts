import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist } from 'zustand/middleware'
import type { ConversationSettings, ModelParameterOverrides } from '@/types'
import { createDefaultConversationSettings } from '@/types'

interface ConversationSettingsState {
  // Settings per conversation (conversationId -> settings)
  settings: Record<string, ConversationSettings>
}

interface ConversationSettingsActions {
  // Get settings for a conversation (creates default if not exists)
  getSettings: (conversationId: string) => ConversationSettings

  // Use provider defaults (no parameters sent)
  setUseProviderDefaults: (conversationId: string, useDefaults: boolean) => void

  // Update parameter overrides
  setParameterOverrides: (
    conversationId: string,
    overrides: ModelParameterOverrides
  ) => void

  // Toggle between custom and preset parameters
  setUseCustomParameters: (conversationId: string, useCustom: boolean) => void

  // Set selected preset ID
  setSelectedPresetId: (conversationId: string, presetId: string | null) => void

  // Set context message count
  setContextMessageCount: (conversationId: string, count: number | null) => void

  // Reset settings to default
  resetSettings: (conversationId: string) => void

  // Remove settings when conversation is deleted
  removeSettings: (conversationId: string) => void
}

type ConversationSettingsStore = ConversationSettingsState & ConversationSettingsActions

export const useConversationSettingsStore = create<ConversationSettingsStore>()(
  persist(
    immer((set, get) => ({
      settings: {},

      getSettings: (conversationId: string) => {
        const existing = get().settings[conversationId]
        if (existing) {
          return existing
        }

        // Create default settings
        const defaultSettings = createDefaultConversationSettings()
        set((draft) => {
          draft.settings[conversationId] = defaultSettings
        })
        return defaultSettings
      },

      setUseProviderDefaults: (conversationId: string, useDefaults: boolean) => {
        set((draft) => {
          if (!draft.settings[conversationId]) {
            draft.settings[conversationId] = createDefaultConversationSettings()
          }
          draft.settings[conversationId].useProviderDefaults = useDefaults
          if (useDefaults) {
            // Clear other parameter settings
            draft.settings[conversationId].useCustomParameters = false
            draft.settings[conversationId].selectedPresetId = null
          }
        })
      },

      setParameterOverrides: (
        conversationId: string,
        overrides: ModelParameterOverrides
      ) => {
        set((draft) => {
          if (!draft.settings[conversationId]) {
            draft.settings[conversationId] = createDefaultConversationSettings()
          }
          draft.settings[conversationId].parameterOverrides = {
            ...draft.settings[conversationId].parameterOverrides,
            ...overrides,
          }
        })
      },

      setUseCustomParameters: (conversationId: string, useCustom: boolean) => {
        set((draft) => {
          if (!draft.settings[conversationId]) {
            draft.settings[conversationId] = createDefaultConversationSettings()
          }
          draft.settings[conversationId].useCustomParameters = useCustom
          if (useCustom) {
            draft.settings[conversationId].selectedPresetId = null
            draft.settings[conversationId].useProviderDefaults = false
          }
        })
      },

      setSelectedPresetId: (conversationId: string, presetId: string | null) => {
        set((draft) => {
          if (!draft.settings[conversationId]) {
            draft.settings[conversationId] = createDefaultConversationSettings()
          }
          draft.settings[conversationId].selectedPresetId = presetId
          if (presetId !== null) {
            draft.settings[conversationId].useCustomParameters = false
            draft.settings[conversationId].useProviderDefaults = false
          }
        })
      },

      setContextMessageCount: (conversationId: string, count: number | null) => {
        set((draft) => {
          if (!draft.settings[conversationId]) {
            draft.settings[conversationId] = createDefaultConversationSettings()
          }
          draft.settings[conversationId].contextMessageCount = count
        })
      },

      resetSettings: (conversationId: string) => {
        set((draft) => {
          draft.settings[conversationId] = createDefaultConversationSettings()
        })
      },

      removeSettings: (conversationId: string) => {
        set((draft) => {
          delete draft.settings[conversationId]
        })
      },
    })),
    {
      name: 'conversation-settings-storage',
      partialize: (state) => ({ settings: state.settings }),
    }
  )
)

