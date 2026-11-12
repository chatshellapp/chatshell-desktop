import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { usePresetStore } from '@/stores/presetStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { useConversationStore } from '@/stores/conversation'
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import { presetToCopyRequest } from '@/lib/preset-utils'
import { logger } from '@/lib/logger'
import type { Assistant, ModelParameterPreset } from '@/types'
import { useRelatedConversations, type RelatedConversations } from './useRelatedConversations'

/**
 * The selected library preset, or null when nothing is selected or it was deleted
 */
export function useSelectedPreset(): ModelParameterPreset | null {
  const selectedPresetId = useLibrarySelectionStore((state) => state.selectedPresetId)
  const presets = usePresetStore((state) => state.presets)

  return useMemo(
    () => (selectedPresetId ? (presets.find((p) => p.id === selectedPresetId) ?? null) : null),
    [selectedPresetId, presets]
  )
}

/** Assistants configured with this preset */
export function usePresetAssistants(presetId: string): Assistant[] {
  const assistants = useAssistantStore((state) => state.assistants)
  return useMemo(
    () => assistants.filter((a) => a.model_parameter_preset_id === presetId),
    [assistants, presetId]
  )
}

/** Conversations whose active parameters come from this preset */
export function usePresetConversations(presetId: string | null): RelatedConversations {
  return useRelatedConversations('list_conversation_ids_by_preset', presetId ? { presetId } : null)
}

function errorDescription(error: unknown) {
  return { description: error instanceof Error ? error.message : String(error) }
}

/**
 * Library actions on presets. Failures are logged and shown as toasts.
 */
export function usePresetActions() {
  const { t } = useTranslation('messages')
  const createPreset = usePresetStore((state) => state.createPreset)
  const deletePresetFromStore = usePresetStore((state) => state.deletePreset)
  const setDefaultPresetInStore = usePresetStore((state) => state.setDefaultPreset)
  const openDraftConversation = useConversationStore((state) => state.openDraftConversation)

  /** Start a new draft chat whose parameters come from the preset */
  const startChatWithPreset = useCallback(
    async (preset: ModelParameterPreset) => {
      try {
        const draft = await openDraftConversation()
        await useConversationSettingsStore.getState().setSelectedPresetId(draft.id, preset.id)
      } catch (error) {
        logger.error('Failed to use preset:', error)
        toast.error(t('failedToUsePreset'), errorDescription(error))
      }
    },
    [openDraftConversation, t]
  )

  /** Copy a preset (never as default). Returns the copy, or null on failure. */
  const duplicatePreset = useCallback(
    async (preset: ModelParameterPreset, name: string): Promise<ModelParameterPreset | null> => {
      try {
        return await createPreset(presetToCopyRequest(preset, name))
      } catch (error) {
        logger.error('Failed to duplicate preset:', error)
        toast.error(t('failedToDuplicatePreset'), errorDescription(error))
        return null
      }
    },
    [createPreset, t]
  )

  const setDefaultPreset = useCallback(
    async (preset: ModelParameterPreset) => {
      try {
        await setDefaultPresetInStore(preset.id)
      } catch (error) {
        logger.error('Failed to set default preset:', error)
        toast.error(t('failedToSetDefaultPreset'), errorDescription(error))
      }
    },
    [setDefaultPresetInStore, t]
  )

  /** Returns true when the preset was deleted */
  const deletePreset = useCallback(
    async (preset: ModelParameterPreset): Promise<boolean> => {
      try {
        await deletePresetFromStore(preset.id)
        return true
      } catch (error) {
        logger.error('Failed to delete preset:', error)
        toast.error(t('failedToDeletePreset'), errorDescription(error))
        return false
      }
    },
    [deletePresetFromStore, t]
  )

  return { startChatWithPreset, duplicatePreset, setDefaultPreset, deletePreset }
}
