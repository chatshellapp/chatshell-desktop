import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMcpStore } from '@/stores/mcpStore'
import { isMcpTool } from '@/types/tool'
import { logger } from '@/lib/logger'

interface McpAuthBannerProps {
  conversationId: string
}

/**
 * In-chat prompt for MCP servers whose sign-in expired.
 *
 * Derived state, not a one-shot notice: a server shows while it is both
 * reported for this conversation and still flagged needs-auth. It goes away
 * when re-auth (here, in Settings, or in the MCP dialog) or a synced grant
 * reconnects it, when it is deselected, disabled or deleted, or when the
 * user dismisses it (until the next report).
 */
export function McpAuthBanner({ conversationId }: McpAuthBannerProps) {
  const { t } = useTranslation('tools')
  const servers = useMcpStore((state) => state.servers)
  const needsAuth = useMcpStore((state) => state.needsAuth)
  const reported = useMcpStore((state) => state.authReports[conversationId])
  const clearAuthReport = useMcpStore((state) => state.clearAuthReport)
  const reauthorize = useMcpStore((state) => state.reauthorize)
  const [authorizingId, setAuthorizingId] = React.useState<string | null>(null)

  const pending = React.useMemo(
    () =>
      (reported ?? [])
        .filter((id) => needsAuth[id])
        .map((id) => servers.find((s) => s.id === id))
        .filter((s): s is NonNullable<typeof s> => !!s && isMcpTool(s) && s.is_enabled),
    [reported, needsAuth, servers]
  )

  if (pending.length === 0) return null

  const handleReauthorize = async (serverId: string) => {
    setAuthorizingId(serverId)
    try {
      await reauthorize(serverId)
    } catch (e) {
      logger.error('[McpAuthBanner] Re-authorization failed', e)
    } finally {
      setAuthorizingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-1.5" role="status">
      {pending.map((server) => (
        <div
          key={server.id}
          className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
        >
          <KeyRound className="size-4 shrink-0 text-warning" />
          <span className="flex-1 min-w-0 truncate">
            {t('mcpSignInExpiredBanner', { name: server.name })}
          </span>
          <Button
            size="sm"
            variant="default"
            className="h-7"
            disabled={authorizingId === server.id}
            onClick={() => handleReauthorize(server.id)}
          >
            {authorizingId === server.id && <Loader2 className="size-3.5 animate-spin mr-1" />}
            {t('reauthorize')}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title={t('dismiss')}
            aria-label={t('dismiss')}
            onClick={() => clearAuthReport(conversationId, server.id)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  )
}
