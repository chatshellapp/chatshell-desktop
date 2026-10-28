import { create } from 'zustand'

interface ProviderSettingsState {
  open: boolean
  /** Provider row to focus when the dialog opens (composer setup CTA).
   * Null opens the provider list at its default selection. */
  initialProviderId: string | null
  openProviderSettings: (providerId?: string | null) => void
  closeProviderSettings: () => void
}

export const useProviderSettingsStore = create<ProviderSettingsState>((set) => ({
  open: false,
  initialProviderId: null,
  openProviderSettings: (providerId = null) =>
    set({ open: true, initialProviderId: providerId ?? null }),
  closeProviderSettings: () => set({ open: false, initialProviderId: null }),
}))
