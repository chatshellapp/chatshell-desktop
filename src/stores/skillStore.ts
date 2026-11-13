import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type { Skill, SkillSourceInfo } from '@/types'
import { logger } from '@/lib/logger'

interface SkillState {
  skills: Skill[]
  sources: SkillSourceInfo[]
  isLoading: boolean
  error: string | null
  hasScanned: boolean

  loadSkills: () => Promise<void>
  scanSkills: () => Promise<void>
  ensureLoaded: () => Promise<void>
  deleteSkill: (id: string) => Promise<void>
  toggleSkill: (id: string) => Promise<Skill>
  setAllEnabled: (enabled: boolean) => Promise<void>
  readSkillContent: (id: string) => Promise<string>
  createSkill: (dirName: string, content: string) => Promise<Skill>
  saveSkillContent: (id: string, content: string) => Promise<Skill>
  openSkillFolder: (id: string) => Promise<void>
  openSourceDirectory: (source: string) => Promise<void>

  setEnabledForIds: (ids: string[], enabled: boolean) => Promise<void>
  getSkillById: (id: string) => Skill | undefined
  loadSources: () => Promise<void>
  setSourceEnabled: (source: string, enabled: boolean) => Promise<void>
}

export const useSkillStore = create<SkillState>()(
  immer((set, get) => ({
    skills: [],
    sources: [],
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
        await get().loadSources()
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

    setEnabledForIds: async (ids: string[], enabled: boolean) => {
      try {
        const skills = await invoke<Skill[]>('set_skills_enabled', { ids, enabled })
        logger.info('[skillStore] Set skills enabled:', { enabled, count: ids.length })
        set((draft) => {
          draft.skills = skills
        })
      } catch (error) {
        logger.error('[skillStore] Failed to set skills enabled:', error)
        throw error
      }
    },

    readSkillContent: async (id: string) => {
      try {
        const content = await invoke<string>('read_skill_content', { id })
        return content
      } catch (error) {
        logger.error('[skillStore] Failed to read skill content:', error)
        throw error
      }
    },

    createSkill: async (dirName: string, content: string) => {
      const skill = await invoke<Skill>('create_user_skill', { dirName, content })
      logger.info('[skillStore] Created skill:', skill.name)
      await get().loadSkills()
      return skill
    },

    saveSkillContent: async (id: string, content: string) => {
      const skill = await invoke<Skill>('save_skill_content', { id, content })
      logger.info('[skillStore] Saved skill:', skill.name)
      await get().loadSkills()
      return skill
    },

    openSkillFolder: async (id: string) => {
      try {
        await invoke('open_skill_folder', { id })
      } catch (error) {
        logger.error('[skillStore] Failed to open skill folder:', error)
        throw error
      }
    },

    openSourceDirectory: async (source: string) => {
      try {
        await invoke('open_skills_directory', { source })
      } catch (error) {
        logger.error('[skillStore] Failed to open skills directory:', error)
      }
    },

    getSkillById: (id: string) => {
      return get().skills.find((s) => s.id === id)
    },

    loadSources: async () => {
      try {
        const sources = await invoke<SkillSourceInfo[]>('get_skill_sources')
        set((draft) => {
          draft.sources = sources
        })
      } catch (error) {
        logger.error('[skillStore] Failed to load skill sources:', error)
      }
    },

    setSourceEnabled: async (source: string, enabled: boolean) => {
      try {
        await invoke('set_skill_source_enabled', { source, enabled })
        set((draft) => {
          const idx = draft.sources.findIndex((s) => s.source === source)
          if (idx >= 0) {
            draft.sources[idx].enabled = enabled
          }
        })
        await get().scanSkills()
      } catch (error) {
        logger.error('[skillStore] Failed to set skill source enabled:', error)
        throw error
      }
    },
  }))
)
