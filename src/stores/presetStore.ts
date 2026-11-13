import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type {
  CreateModelParameterPresetRequest,
  ModelParameterPreset,
  UpdateModelParameterPresetRequest,
} from '@/types'
import { logger } from '@/lib/logger'

interface PresetState {
  presets: ModelParameterPreset[]
  isLoaded: boolean
  isLoading: boolean
  error: string | null

  loadPresets: () => Promise<void>
  ensureLoaded: () => Promise<void>
  createPreset: (req: CreateModelParameterPresetRequest) => Promise<ModelParameterPreset>
  updatePreset: (
    id: string,
    req: UpdateModelParameterPresetRequest
  ) => Promise<ModelParameterPreset>
  setDefaultPreset: (id: string) => Promise<ModelParameterPreset>
  deletePreset: (id: string) => Promise<void>
}

/**
 * Model parameter presets, shared by the Library and the chat input so a
 * preset created or edited in one place shows up everywhere.
 */
export const usePresetStore = create<PresetState>()(
  immer((set, get) => ({
    presets: [],
    isLoaded: false,
    isLoading: false,
    error: null,

    loadPresets: async () => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const presets = await invoke<ModelParameterPreset[]>('list_model_parameter_presets')
        set((draft) => {
          draft.presets = presets
          draft.isLoaded = true
          draft.isLoading = false
        })
      } catch (error) {
        logger.error('[presetStore] Failed to load presets:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
      }
    },

    ensureLoaded: async () => {
      if (get().isLoaded || get().isLoading) return
      await get().loadPresets()
    },

    createPreset: async (req) => {
      const preset = await invoke<ModelParameterPreset>('create_model_parameter_preset', { req })
      // Creating a default clears the flag elsewhere; reload to stay in sync
      if (preset.is_default) await get().loadPresets()
      else
        set((draft) => {
          draft.presets.push(preset)
        })
      return preset
    },

    updatePreset: async (id, req) => {
      const preset = await invoke<ModelParameterPreset>('update_model_parameter_preset', {
        id,
        req,
      })
      if (req.is_default) await get().loadPresets()
      else
        set((draft) => {
          const index = draft.presets.findIndex((p) => p.id === id)
          if (index >= 0) draft.presets[index] = preset
        })
      return preset
    },

    setDefaultPreset: async (id) => {
      const preset = await invoke<ModelParameterPreset>('set_default_model_parameter_preset', {
        id,
      })
      await get().loadPresets()
      return preset
    },

    deletePreset: async (id) => {
      await invoke('delete_model_parameter_preset', { id })
      set((draft) => {
        draft.presets = draft.presets.filter((p) => p.id !== id)
      })
    },
  }))
)
