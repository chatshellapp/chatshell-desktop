import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Cloud, CloudOff, Copy, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useSyncSetupStore } from '@/stores/syncSetupStore'
import { syncErrorCopy } from '@/lib/sync-error'
import { logger } from '@/lib/logger'

/**
 * Sync enablement card (ADR 04 §7): one confirmation merging three jobs —
 * consent, passphrase bootstrap (the generated passphrase is shown once with
 * save guidance), and recovery education. Rendered both as the final step of
 * the general onboarding flow and inside the standalone
 * {@link SyncOnboardingDialog} for the launch-time (re-)ask. After enabling,
 * sync is fully invisible; declining is treated as off and asked about once
 * more at the next launch, then becomes a settings item only.
 *
 * State lives and dies with the mount: the card is only rendered while the
 * offer is open, so closing unmounts and resets it.
 */
export function SyncOnboardingCard({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation('sync')
  const { info, startOnboarding, completeOnboarding, declineOnboarding, unlock, tryJoin } =
    useSyncSetupStore()
  const [passphrase, setPassphrase] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  // A remote group already exists (fresh device joining): consent still
  // applies, but joining is the passphrase-unlock path — never a competing
  // bootstrap (ADR 04 §3).
  const [joinMode, setJoinMode] = useState(false)
  const [joinPassphrase, setJoinPassphrase] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)

  useEffect(() => {
    if (info?.group_exists && passphrase === null && !joinMode) {
      setJoinMode(true)
      // Silent Keychain adoption first (ADR 04 §3 rung 1); the passphrase
      // input below is the fallback this attempt rejects into.
      tryJoin()
        .then(() => {
          setBusy(false)
          toast.success(t('onboarding.joined'))
          onDone?.()
        })
        .catch(() => {
          // Passphrase rung — the join input stays visible.
        })
    }
  }, [info?.group_exists])

  async function handleJoin() {
    setBusy(true)
    setErrorText(null)
    try {
      await unlock(joinPassphrase)
      toast.success(t('locked.unlocked'))
      onDone?.()
    } catch (err) {
      setErrorText(syncErrorCopy(err))
    } finally {
      setBusy(false)
    }
  }
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
      onDone?.()
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
      onDone?.()
    } catch (err) {
      logger.error('Failed to decline sync onboarding:', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5" />
          {t('onboarding.title')}
        </DialogTitle>
        <DialogDescription>{t('onboarding.description')}</DialogDescription>
      </DialogHeader>

      {joinMode ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('onboarding.joinExplainer')}</p>
          <Input
            type="password"
            value={joinPassphrase}
            onChange={(e) => setJoinPassphrase(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && joinPassphrase && handleJoin()}
            placeholder={t('locked.placeholder')}
          />
          {errorText && <p className="text-sm text-red-500">{errorText}</p>}
        </div>
      ) : passphrase === null ? (
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
        {joinMode ? (
          <Button onClick={handleJoin} disabled={!joinPassphrase || busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('onboarding.join')}
          </Button>
        ) : passphrase === null ? (
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
    </>
  )
}
