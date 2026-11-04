// Approval dialog for the tool permission gate (ask mode). Fed by the
// permission store (a FIFO queue: each stream has at most one pending
// approval, but several conversations can stream at once — the dialog
// shows the oldest and counts the rest); answers go back through the
// `resolve_permission` command. Buttons arm after a short delay so a
// composer keystroke cannot answer the prompt reflexively (omp's
// anti-reflex measure).

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { invoke } from '@tauri-apps/api/core'
import { ShieldAlert, ShieldQuestion, TriangleAlert } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  usePermissionStore,
  type PermissionGrant,
  type PermissionWarningKind,
} from '@/stores/permissionStore'
import { logger } from '@/lib/logger'

/// Buttons stay disabled for this long after the dialog opens.
const ARM_DELAY_MS = 500

/** Exactly what an approval covers: bash keys as chips (every segment of
 * a compound is listed), other scopes as one line. */
function GrantScopeView({
  t,
  grant,
  label,
}: {
  t: TFunction
  grant: PermissionGrant
  label: 'scope' | 'rememberScope'
}) {
  if (grant.kind === 'bash') {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">{t(`permission.${label}.bash`)}</p>
        <div className="flex flex-wrap gap-1.5" data-testid={`${label}-chips`}>
          {grant.bases.map((base) => (
            <Badge key={base} variant="secondary" className="font-mono text-xs">
              {base}
            </Badge>
          ))}
        </div>
      </div>
    )
  }
  let text: string
  switch (grant.kind) {
    case 'tool':
      text = t(`permission.${label}.tool`, { tool: grant.tool })
      break
    case 'server_tool':
      text = t(`permission.${label}.serverTool`, { subject: `${grant.server}/${grant.tool}` })
      break
    case 'directory':
      text = t(`permission.${label}.directory`, { tool: grant.tool, dir: grant.dir })
      break
  }
  return <p className="text-xs text-muted-foreground break-all">{text}</p>
}

function warningText(t: TFunction, kind: PermissionWarningKind): string {
  switch (kind) {
    case 'security':
      return t('permission.warning.security')
    case 'unparsed':
      return t('permission.warning.unparsed')
    case 'network':
      return t('permission.warning.network')
    case 'private_network':
      return t('permission.warning.privateNetwork')
    case 'sandbox':
      return t('permission.warning.sandbox')
    case 'sandbox_network':
      return t('permission.warning.sandboxNetwork')
  }
}

type Decision =
  | 'allow-once'
  | 'allow-session'
  | 'deny'
  | 'retry-unsandboxed'
  | 'allow-network-session'

export function PermissionApprovalDialog() {
  const { t } = useTranslation('chat')
  const queue = usePermissionStore((state) => state.pending)
  const remove = usePermissionStore((state) => state.remove)
  const pending = queue[0]
  const [armed, setArmed] = useState(false)
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    if (!pending) return
    setArmed(false)
    setRemember(false)
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS)
    return () => clearTimeout(timer)
  }, [pending])

  if (!pending) return null

  const escalation = pending.escalation ?? null

  const answer = async (decision: Decision) => {
    const requestId = pending.requestId
    remove(requestId)
    try {
      await invoke('resolve_permission', {
        request: {
          requestId,
          decision,
          remember:
            remember &&
            (decision === 'allow-once' || decision === 'allow-session') &&
            Boolean(pending.remember),
        },
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
            {escalation ? (
              <ShieldAlert className="size-5 shrink-0 text-destructive" />
            ) : (
              <ShieldQuestion className="size-5 shrink-0 text-destructive" />
            )}
            {escalation ? t('permission.escalation.title') : t('permission.title')}
          </DialogTitle>
          <DialogDescription className="text-left">
            {escalation
              ? t('permission.escalation.body')
              : t('permission.body', {
                  tool: pending.toolName,
                  subject: pending.subject,
                })}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
          {pending.subject}
        </div>
        {pending.warning && (
          <div
            role="alert"
            className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs"
          >
            <TriangleAlert className="size-4 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="font-medium">{warningText(t, pending.warning.kind)}</p>
              <p className="break-all text-muted-foreground">{pending.warning.detail}</p>
            </div>
          </div>
        )}
        {pending.grant && <GrantScopeView t={t} grant={pending.grant} label="scope" />}
        {pending.remember && (
          <div className="grid gap-1.5 rounded-md border px-3 py-2.5">
            {/* Checkbox and label share one centered row; the scope text
                below is indented to the label (size-4 box + gap-2). */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="permission-remember"
                checked={remember}
                disabled={!armed}
                onCheckedChange={(checked) => setRemember(checked === true)}
              />
              <Label htmlFor="permission-remember" className="cursor-pointer">
                {t('permission.remember')}
              </Label>
            </div>
            <div className="pl-6">
              <GrantScopeView t={t} grant={pending.remember} label="rememberScope" />
            </div>
          </div>
        )}
        {queue.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {t('permission.queueCount', { count: queue.length - 1 })}
          </p>
        )}
        {escalation ? (
          // Escalation labels are long: stack full-width actions, most
          // likely escape first, denial last.
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {escalation.network_option && (
              <Button
                className="w-full"
                disabled={!armed}
                onClick={() => answer('allow-network-session')}
              >
                {t('permission.escalation.allowNetwork')}
              </Button>
            )}
            {escalation.retry_option !== false && (
              <Button
                className="w-full"
                variant={escalation.network_option ? 'secondary' : 'default'}
                disabled={!armed}
                onClick={() => answer('retry-unsandboxed')}
              >
                {t('permission.escalation.retryOutside')}
              </Button>
            )}
            <Button
              className="w-full"
              variant="outline"
              disabled={!armed}
              onClick={() => answer('deny')}
            >
              {t('permission.deny')}
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" disabled={!armed} onClick={() => answer('deny')}>
              {t('permission.deny')}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {pending.grant && (
                <Button
                  variant="secondary"
                  disabled={!armed}
                  onClick={() => answer('allow-session')}
                >
                  {t('permission.allowSession')}
                </Button>
              )}
              <Button disabled={!armed} onClick={() => answer('allow-once')}>
                {t('permission.allowOnce')}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
