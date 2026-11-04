// Settings > Permissions: how tool calls (built-in and MCP) are approved,
// the OS sandbox behind Auto mode, and what the terminal can see.

import { useTranslation } from 'react-i18next'
import { Box } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useSandboxStatus } from '@/lib/permission-mode'
import { BashEnvironment } from './bash-environment'
import { DefaultPermissionMode } from './default-permission-mode'
import { RememberedApprovals } from './remembered-approvals'
import { SettingsCard } from './settings-card'

function SandboxStatusCard() {
  const { t } = useTranslation('settings')
  const status = useSandboxStatus()
  if (!status) return null
  const backend =
    status.backend === 'seatbelt'
      ? t('sandboxBackendSeatbelt')
      : status.backend === 'bubblewrap'
        ? t('sandboxBackendBubblewrap')
        : null
  return (
    <SettingsCard
      icon={Box}
      title={t('sandboxStatus')}
      description={status.available ? t('sandboxStatusAvailable') : t('sandboxStatusUnavailable')}
      action={
        <Badge
          variant={status.available ? 'secondary' : 'outline'}
          data-testid="sandbox-status-badge"
        >
          {status.available ? backend : t('sandboxNotAvailable')}
        </Badge>
      }
    />
  )
}

export function PermissionsSettings() {
  const { t } = useTranslation('settings')
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('permissionsSectionDescription')}</p>
      <DefaultPermissionMode />
      <SandboxStatusCard />
      <RememberedApprovals />
      <BashEnvironment />
    </div>
  )
}
