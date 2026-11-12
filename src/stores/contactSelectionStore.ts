import { create } from 'zustand'

export type ContactKind = 'model' | 'assistant'

export interface ContactSelection {
  kind: ContactKind
  /** Database id of the model or assistant */
  id: string
}

interface ContactSelectionState {
  /** Contact whose profile the main pane shows while the Contacts section is active */
  selected: ContactSelection | null
  selectContact: (selection: ContactSelection) => void
  clearContact: () => void
}

export const useContactSelectionStore = create<ContactSelectionState>((set) => ({
  selected: null,
  selectContact: (selection) => set({ selected: selection }),
  clearContact: () => set({ selected: null }),
}))
