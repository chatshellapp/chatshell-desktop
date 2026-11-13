import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useSkillStore } from '@/stores/skillStore'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import { logger } from '@/lib/logger'
import type { Skill } from '@/types'

/**
 * The selected library skill, or null when nothing is selected or it was deleted
 */
export function useSelectedSkill(): Skill | null {
  const selectedSkillId = useLibrarySelectionStore((state) => state.selectedSkillId)
  const skills = useSkillStore((state) => state.skills)

  return useMemo(
    () => (selectedSkillId ? (skills.find((s) => s.id === selectedSkillId) ?? null) : null),
    [selectedSkillId, skills]
  )
}

function errorDescription(error: unknown) {
  return { description: error instanceof Error ? error.message : String(error) }
}

/**
 * Library actions on skills. Failures are logged and shown as toasts.
 */
export function useSkillActions() {
  const { t } = useTranslation('skills')
  const toggleSkillInStore = useSkillStore((state) => state.toggleSkill)
  const deleteSkillFromStore = useSkillStore((state) => state.deleteSkill)
  const openSkillFolderInStore = useSkillStore((state) => state.openSkillFolder)

  const toggleSkill = useCallback(
    async (skill: Skill) => {
      try {
        await toggleSkillInStore(skill.id)
      } catch (error) {
        logger.error('Failed to toggle skill:', error)
        toast.error(t('failedToToggleSkill'), errorDescription(error))
      }
    },
    [toggleSkillInStore, t]
  )

  const openSkillFolder = useCallback(
    async (skill: Skill) => {
      try {
        await openSkillFolderInStore(skill.id)
      } catch (error) {
        toast.error(t('failedToOpenFolder'), errorDescription(error))
      }
    },
    [openSkillFolderInStore, t]
  )

  /** Returns true when the skill was deleted */
  const deleteSkill = useCallback(
    async (skill: Skill): Promise<boolean> => {
      try {
        await deleteSkillFromStore(skill.id)
        toast.success(t('deleted'))
        return true
      } catch (error) {
        logger.error('Failed to delete skill:', error)
        toast.error(t('failedToDeleteSkill'), errorDescription(error))
        return false
      }
    },
    [deleteSkillFromStore, t]
  )

  return { toggleSkill, openSkillFolder, deleteSkill }
}
