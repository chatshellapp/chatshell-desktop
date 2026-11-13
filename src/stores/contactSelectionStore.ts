import { create } from 'zustand'

export type ContactKind = 'model' | 'assistant'

export type ContactsTab = 'models' | 'assistants' | 'people'

export interface ContactSelection {
  kind: ContactKind
  /** Database id of the model or assistant */
  id: string
}

interface ContactSelectionState {
  /** Contacts tab shown in the sidebar */
  activeTab: ContactsTab
  setActiveTab: (tab: ContactsTab) => void
  /** Contact whose profile the main pane shows while the Contacts section is active */
  selected: ContactSelection | null
  selectContact: (selection: ContactSelection) => void
  clearContact: () => void
}

export const useContactSelectionStore = create<ContactSelectionState>((set) => ({
  activeTab: 'models',
  setActiveTab: (tab) => set({ activeTab: tab }),
  selected: null,
  // Show the tab the contact lives on so the sidebar highlights it
  selectContact: (selection) =>
    set({
      selected: selection,
      activeTab: selection.kind === 'model' ? 'models' : 'assistants',
    }),
  clearContact: () => set({ selected: null }),
}))
