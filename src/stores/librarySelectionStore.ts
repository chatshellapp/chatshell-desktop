import { create } from 'zustand'

export type LibraryTab = 'prompts' | 'skills' | 'presets'

interface LibrarySelectionState {
  /** Library tab shown in the sidebar; decides which selection the main pane shows */
  activeTab: LibraryTab
  /** Prompt whose detail page the main pane shows on the Prompts tab */
  selectedPromptId: string | null
  /** Preset whose detail page the main pane shows on the Presets tab */
  selectedPresetId: string | null
  /** Skill whose detail page the main pane shows on the Skills tab */
  selectedSkillId: string | null
  setActiveTab: (tab: LibraryTab) => void
  selectPrompt: (promptId: string) => void
  clearPrompt: () => void
  selectPreset: (presetId: string) => void
  clearPreset: () => void
  selectSkill: (skillId: string) => void
  clearSkill: () => void
}

export const useLibrarySelectionStore = create<LibrarySelectionState>((set) => ({
  activeTab: 'prompts',
  selectedPromptId: null,
  selectedPresetId: null,
  selectedSkillId: null,
  setActiveTab: (tab) => set({ activeTab: tab }),
  selectPrompt: (promptId) => set({ selectedPromptId: promptId }),
  clearPrompt: () => set({ selectedPromptId: null }),
  selectPreset: (presetId) => set({ selectedPresetId: presetId }),
  clearPreset: () => set({ selectedPresetId: null }),
  selectSkill: (skillId) => set({ selectedSkillId: skillId }),
  clearSkill: () => set({ selectedSkillId: null }),
}))
