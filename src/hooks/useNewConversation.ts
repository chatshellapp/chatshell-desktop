import { useCallback } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { requestComposerFocus } from '@/lib/composer-focus'
import { useConversationStore } from '@/stores/conversation'
import { logger } from '@/lib/logger'

/** Opens an unsaved draft conversation and focuses the composer. */
export function useNewConversation() {
  const { t } = useTranslation('messages')
  const openDraftConversation = useConversationStore((state) => state.openDraftConversation)

  return useCallback(async () => {
    try {
      // Rescan skill directories so newly added skills are indexed before
      // conversation settings (which default to all globally enabled skills) are loaded.
      const { useSkillStore } = await import('@/stores/skillStore')
      await useSkillStore.getState().scanSkills()

      // A new draft becomes current, which triggers the composer focus effect
      await openDraftConversation()
      // Reopening the already-current draft changes nothing, so focus explicitly
      requestComposerFocus()
    } catch (error) {
      logger.error('Failed to create new conversation:', error)
      toast.error(t('failedToCreateConversation'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [openDraftConversation, t])
}
