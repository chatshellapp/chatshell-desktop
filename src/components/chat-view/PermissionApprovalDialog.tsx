// Approval dialog for the tool permission gate (ask mode). Fed by the
// permission store (a FIFO queue: rig runs tool calls concurrently, so
// several approvals can be pending at once — the dialog shows the
// oldest and counts the rest); answers go back through the
// `resolve_permission` command. Buttons arm after a short delay so a
// composer keystroke cannot answer the prompt reflexively (omp's
// anti-reflex measure).

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
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
import { usePermissionStore, type PermissionGrant } from '@/stores/permissionStore'
import { logger } from '@/lib/logger'

/// Buttons stay disabled for this long after the dialog opens.
const ARM_DELAY_MS = 500

function grantScopeText(t: TFunction, grant: PermissionGrant): string {
  switch (grant.kind) {
    case 'bash':
      return t('permission.scope.bash', { bases: grant.bases.join(', ') })
    case 'tool':
      return t('permission.scope.tool', { tool: grant.tool })
    case 'server_tool':
      return t('permission.scope.serverTool', {
        subject: `${grant.server}/${grant.tool}`,
      })
  }
}

export function PermissionApprovalDialog() {
  const { t } = useTranslation('chat')
  const queue = usePermissionStore((state) => state.pending)
  const clear = usePermissionStore((state) => state.clear)
  const pending = queue[0]
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
    clear(requestId)
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
        {pending.grant && (
          <p className="text-xs text-muted-foreground">{grantScopeText(t, pending.grant)}</p>
        )}
        {queue.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {t('permission.queueCount', { count: queue.length - 1 })}
          </p>
        )}
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="outline" disabled={!armed} onClick={() => answer('deny')}>
            {t('permission.deny')}
          </Button>
          <div className="flex gap-2">
            {pending.grant && (
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
