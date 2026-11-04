// Remembered tool approvals ("remember on this device" answers on the
// approval card). They live in a per-device file outside the synced
// database; this card shows how many are kept and clears them.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import { SettingsCard } from './settings-card'

export function RememberedApprovals() {
  const { t } = useTranslation('settings')
  const [count, setCount] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setCount(await invoke<number>('count_permission_grants'))
    } catch (error) {
      logger.error('[RememberedApprovals] count_permission_grants failed:', error)
      setCount(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const clear = async () => {
    setClearing(true)
    try {
      const removed = await invoke<number>('clear_permission_grants')
      toast.success(t('rememberedApprovalsCleared', { count: removed }))
    } catch (error) {
      logger.error('[RememberedApprovals] clear_permission_grants failed:', error)
      toast.error(t('rememberedApprovalsClearFailed'))
    } finally {
      setClearing(false)
      await refresh()
    }
  }

  return (
    <SettingsCard
      icon={ShieldCheck}
      title={t('rememberedApprovals')}
      description={t('rememberedApprovalsDescription')}
      action={
        <Button variant="outline" size="sm" onClick={clear} disabled={clearing || count === 0}>
          {t('rememberedApprovalsClear')}
        </Button>
      }
    >
      {count !== null && (
        <p className="text-xs text-muted-foreground" data-testid="remembered-approvals-count">
          {t('rememberedApprovalsCount', { count })}
        </p>
      )}
    </SettingsCard>
  )
}
