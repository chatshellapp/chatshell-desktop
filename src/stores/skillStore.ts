import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type { Skill } from '@/types'
import { logger } from '@/lib/logger'

interface SkillState {
  skills: Skill[]
  isLoading: boolean
  error: string | null
  hasScanned: boolean

  // Actions
  loadSkills: () => Promise<void>
  scanSkills: () => Promise<void>
  ensureLoaded: () => Promise<void>
  deleteSkill: (id: string) => Promise<void>
  toggleSkill: (id: string) => Promise<Skill>
  setAllEnabled: (enabled: boolean) => Promise<void>
  readSkillContent: (path: string) => Promise<string>
  getSkillById: (id: string) => Skill | undefined
}

export const useSkillStore = create<SkillState>()(
  immer((set, get) => ({
    skills: [],
    isLoading: false,
    error: null,
    hasScanned: false,

    loadSkills: async () => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const skills = await invoke<Skill[]>('list_skills')
        logger.info('[skillStore] Loaded skills:', skills.length)
        set((draft) => {
          draft.skills = skills
          draft.isLoading = false
        })
      } catch (error) {
        logger.error('[skillStore] Failed to load skills:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
      }
    },

    scanSkills: async () => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const skills = await invoke<Skill[]>('scan_skills')
        logger.info('[skillStore] Scanned and loaded skills:', skills.length)
        set((draft) => {
          draft.skills = skills
          draft.isLoading = false
          draft.hasScanned = true
        })
      } catch (error) {
        logger.error('[skillStore] Failed to scan skills:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
      }
    },

    ensureLoaded: async () => {
      const state = get()
      if (state.skills.length === 0 && !state.isLoading && !state.hasScanned) {
        await get().scanSkills()
      }
    },

    deleteSkill: async (id: string) => {
      try {
        await invoke('delete_skill', { id })
        logger.info('[skillStore] Deleted skill:', id)
        set((draft) => {
          draft.skills = draft.skills.filter((s: Skill) => s.id !== id)
        })
      } catch (error) {
        logger.error('[skillStore] Failed to delete skill:', error)
        throw error
      }
    },

    toggleSkill: async (id: string) => {
      try {
        const skill = await invoke<Skill>('toggle_skill', { id })
        logger.info('[skillStore] Toggled skill:', { name: skill.name, enabled: skill.is_enabled })
        set((draft) => {
          const index = draft.skills.findIndex((s: Skill) => s.id === id)
          if (index >= 0) {
            draft.skills[index] = skill
          }
        })
        return skill
      } catch (error) {
        logger.error('[skillStore] Failed to toggle skill:', error)
        throw error
      }
    },

    setAllEnabled: async (enabled: boolean) => {
      try {
        const skills = await invoke<Skill[]>('set_all_skills_enabled', { enabled })
        logger.info('[skillStore] Set all skills enabled:', { enabled, count: skills.length })
        set((draft) => {
          draft.skills = skills
        })
      } catch (error) {
        logger.error('[skillStore] Failed to set all skills enabled:', error)
        throw error
      }
    },

    readSkillContent: async (path: string) => {
      try {
        const content = await invoke<string>('read_skill_content', { path })
        return content
      } catch (error) {
        logger.error('[skillStore] Failed to read skill content:', error)
        throw error
      }
    },

    getSkillById: (id: string) => {
      return get().skills.find((s) => s.id === id)
    },
  }))
)
