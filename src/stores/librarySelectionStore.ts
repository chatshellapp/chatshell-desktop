import { create } from 'zustand'

interface LibrarySelectionState {
  /** Prompt whose detail page the main pane shows while the Library section is active */
  selectedPromptId: string | null
  selectPrompt: (promptId: string) => void
  clearPrompt: () => void
}

export const useLibrarySelectionStore = create<LibrarySelectionState>((set) => ({
  selectedPromptId: null,
  selectPrompt: (promptId) => set({ selectedPromptId: promptId }),
  clearPrompt: () => set({ selectedPromptId: null }),
}))
