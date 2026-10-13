'use client'

import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'

const OBSCURA_REPO_URL = 'https://github.com/h4ckf0r0day/obscura'

/**
 * Guidance shown in Web Fetch settings when no obscura binary is installed.
 * Obscura is an opportunistic browser tier: installing the binary upgrades the
 * automatic fallback chain (web fetch and web-search scraping) without any
 * configuration — the binary is resolved per call, so no app restart is needed.
 * Rendered only while `is_obscura_available` reports false.
 */
export function ObscuraInstallHint() {
  const { t } = useTranslation('settings')

  const handleLearnMore = async () => {
    try {
      await openUrl(OBSCURA_REPO_URL)
    } catch (error) {
      logger.error('Failed to open Obscura repository:', error)
      toast.error(String(error))
    }
  }

  return (
    <div className="flex max-w-md items-start gap-2 rounded-md border border-muted bg-muted/30 px-3 py-2.5">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="grid gap-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t('obscuraHintTitle')}</span>
        <span>{t('obscuraHintBody')}</span>
        <span>{t('obscuraHintInstallNote')}</span>
        <button
          type="button"
          onClick={handleLearnMore}
          className="w-fit text-left font-medium text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {t('obscuraLearnMore')}
        </button>
      </div>
    </div>
  )
}
