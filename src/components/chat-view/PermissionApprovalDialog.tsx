// Approval dialog for the tool permission gate (ask mode). Fed by the
// permission store; answers go back through the `resolve_permission`
// command. Buttons arm after a short delay so a composer keystroke
// cannot answer the prompt reflexively (omp's anti-reflex measure).

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { ShieldQuestion } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { usePermissionStore } from '@/stores/permissionStore'
import { logger } from '@/lib/logger'

/// Buttons stay disabled for this long after the dialog opens.
const ARM_DELAY_MS = 500

export function PermissionApprovalDialog() {
  const { t } = useTranslation('chat')
  const pending = usePermissionStore((state) => state.pending)
  const clear = usePermissionStore((state) => state.clear)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!pending) return
    setArmed(false)
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS)
    return () => clearTimeout(timer)
  }, [pending])

  if (!pending) return null

  const answer = async (decision: 'allow-once' | 'allow-session' | 'deny') => {
    const requestId = pending.requestId
    clear()
    try {
      await invoke('resolve_permission', {
        request: { requestId, decision },
      })
    } catch (error) {
      logger.error('[PermissionApprovalDialog] resolve_permission failed:', error)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && answer('deny')}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldQuestion className="size-5 text-destructive" />
            {t('permission.title')}
          </DialogTitle>
          <DialogDescription className="text-left">
            {t('permission.body', {
              tool: pending.toolName,
              subject: pending.subject,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
          {pending.subject}
        </div>
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="outline" disabled={!armed} onClick={() => answer('deny')}>
            {t('permission.deny')}
          </Button>
          <div className="flex gap-2">
            {pending.allowSession && (
              <Button variant="secondary" disabled={!armed} onClick={() => answer('allow-session')}>
                {t('permission.allowSession')}
              </Button>
            )}
            <Button disabled={!armed} onClick={() => answer('allow-once')}>
              {t('permission.allowOnce')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
