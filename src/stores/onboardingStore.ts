import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type OnboardingStep = 'checking' | 'no-provider' | 'local-ready' | 'sync' | 'complete'

interface OnboardingStore {
  step: OnboardingStep
  isDialogOpen: boolean
  /** True once this session's general onboarding flow is triggered: the
   * sync-enable card (ADR 04 §7) is a step of that flow, so the standalone
   * launch-time sync dialog must stay suppressed for the whole session. */
  flowOwnsSyncOffer: boolean

  // Actions
  setStep: (step: OnboardingStep) => void
  setDialogOpen: (open: boolean) => void
  markFlowOwnsSyncOffer: () => void
}

export const useOnboardingStore = create<OnboardingStore>()(
  immer((set) => ({
    step: 'checking',
    isDialogOpen: false,
    flowOwnsSyncOffer: false,

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

    markFlowOwnsSyncOffer: () => {
      set((draft) => {
        draft.flowOwnsSyncOffer = true
      })
    },
  }))
)
