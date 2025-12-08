import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type { ModelInfo } from '@/types'

export type OnboardingStep =
  | 'checking'
  | 'ollama-detected'
  | 'no-provider'
  | 'creating-assistant'
  | 'complete'

interface OnboardingStore {
  step: OnboardingStep
  isDialogOpen: boolean
  ollamaModels: ModelInfo[]
  isCheckingOllama: boolean
  error: string | null

  // Actions
  checkOllama: () => Promise<boolean>
  setStep: (step: OnboardingStep) => void
  setDialogOpen: (open: boolean) => void
  setError: (error: string | null) => void
  resetOnboarding: () => void
}

export const useOnboardingStore = create<OnboardingStore>()(
  immer((set) => ({
    step: 'checking',
    isDialogOpen: false,
    ollamaModels: [],
    isCheckingOllama: false,
    error: null,

    checkOllama: async () => {
      set((draft) => {
        draft.isCheckingOllama = true
        draft.error = null
      })

      try {
        const models = await invoke<ModelInfo[]>('fetch_ollama_models', {
          baseUrl: 'http://localhost:11434',
        })

        set((draft) => {
          draft.ollamaModels = models
          draft.isCheckingOllama = false
        })

        return models.length > 0
      } catch (error) {
        console.log('[onboarding] Ollama not available:', error)
        set((draft) => {
          draft.ollamaModels = []
          draft.isCheckingOllama = false
        })
        return false
      }
    },

    setStep: (step) => {
      set((draft) => {
        draft.step = step
      })
    },

    setDialogOpen: (open) => {
      set((draft) => {
        draft.isDialogOpen = open
      })
    },

    setError: (error) => {
      set((draft) => {
        draft.error = error
      })
    },

    resetOnboarding: () => {
      set((draft) => {
        draft.step = 'checking'
        draft.isDialogOpen = false
        draft.ollamaModels = []
        draft.error = null
      })
    },
  }))
)

