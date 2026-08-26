import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Cloud, CloudOff, Copy, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useSyncSetupStore } from '@/stores/syncSetupStore'
import { logger } from '@/lib/logger'

/**
 * First-launch sync onboarding card (ADR 04 §7): one confirmation merging
 * three jobs — consent, passphrase bootstrap (the generated passphrase is
 * shown once with save guidance), and recovery education. After enabling,
 * sync is fully invisible; declining is treated as off and asked about
 * once more at the next launch, then becomes a settings item only.
 */
export function SyncOnboardingDialog() {
  const { t } = useTranslation('sync')
  const { info, startOnboarding, completeOnboarding, declineOnboarding } = useSyncSetupStore()
  const [passphrase, setPassphrase] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const open = Boolean(info?.needsOnboarding)

  useEffect(() => {
    if (!open) {
      setPassphrase(null)
      setSaved(false)
    }
  }, [open])

  async function handleBegin() {
    try {
      setPassphrase(await startOnboarding())
    } catch (err) {
      logger.error('Failed to generate sync passphrase:', err)
      toast.error(t('onboarding.error'))
    }
  }

  async function handleEnable() {
    if (!passphrase) return
    setBusy(true)
    try {
      await completeOnboarding(passphrase)
      toast.success(t('onboarding.enabled'))
    } catch (err) {
      logger.error('Failed to enable sync:', err)
      toast.error(String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDecline() {
    setBusy(true)
    try {
      await declineOnboarding()
    } catch (err) {
      logger.error('Failed to decline sync onboarding:', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            {t('onboarding.title')}
          </DialogTitle>
          <DialogDescription>{t('onboarding.description')}</DialogDescription>
        </DialogHeader>

        {passphrase === null ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('onboarding.explainer')}</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                {t('onboarding.pointEncrypted')}
              </li>
              <li className="flex gap-2">
                <CloudOff className="h-4 w-4 shrink-0 mt-0.5" />
                {t('onboarding.pointOffDevice')}
              </li>
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm font-medium">{t('onboarding.passphraseTitle')}</p>
            <div className="rounded-md border bg-muted/50 p-3 font-mono text-sm break-all select-all">
              {passphrase}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t('onboarding.passphraseGuidance')}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(passphrase)
                  toast.success(t('onboarding.copied'))
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                {t('onboarding.copy')}
              </Button>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} />
              <span className="text-muted-foreground">{t('onboarding.confirmSaved')}</span>
            </label>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('onboarding.recoveryEducation')}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={handleDecline} disabled={busy}>
            {t('onboarding.decline')}
          </Button>
          {passphrase === null ? (
            <Button onClick={handleBegin} disabled={busy}>
              <KeyRound className="mr-2 h-4 w-4" />
              {t('onboarding.begin')}
            </Button>
          ) : (
            <Button onClick={handleEnable} disabled={!saved || busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('onboarding.enable')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
