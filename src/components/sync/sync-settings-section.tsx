import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CloudCog, CloudUpload, KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { syncErrorCopy } from '@/lib/sync-error'
import { useSyncSetupStore } from '@/stores/syncSetupStore'

/**
 * Settings surface for sync enablement (ADR 04 §7): status, re-enable,
 * two-tier disable (stop publishing — default, peers untouched — versus
 * delete my cloud data, destructive and separately confirmed), and the
 * manual escape hatches for a broken auto-sync: Sync now (full pass that
 * also rebuilds a wedged engine), Force publish (unconditional version
 * bump for stranded rows), and the passphrase unlock when the content key
 * cannot be resolved automatically.
 */
export function SyncSettingsSection() {
  const { t } = useTranslation('sync')
  const { info, enable, disable, unlock, syncNow, forcePublish } = useSyncSetupStore()
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)

  const enabled = info?.enabled ?? false
  const needsPassphrase = info?.needs_passphrase ?? false
  const lastError = info?.last_pass_error ?? null

  async function handleEnable() {
    setBusy(true)
    try {
      await enable()
      toast.success(t('settings.statusEnabled'))
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDisable(deleteCloudData: boolean) {
    setBusy(true)
    try {
      const summary = await disable(deleteCloudData)
      toast.info(summary)
      setDeleteOpen(false)
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleSyncNow() {
    setBusy(true)
    try {
      const result = await syncNow()
      if (result.enabled) {
        toast.success(
          t('settings.syncNowDone', { action: result.action, rows: result.rows_merged })
        )
      } else {
        toast.info(t('settings.statusDisabled'))
      }
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleForcePublish() {
    setBusy(true)
    try {
      const result = await forcePublish()
      if (result.enabled) {
        toast.success(
          t('settings.syncNowDone', { action: result.action, rows: result.rows_merged })
        )
      } else {
        toast.info(t('settings.statusDisabled'))
      }
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleUnlock() {
    setBusy(true)
    setErrorText(null)
    try {
      await unlock(passphrase)
      toast.success(t('locked.unlocked'))
      setUnlockOpen(false)
      setPassphrase('')
    } catch (err) {
      setErrorText(syncErrorCopy(err))
    } finally {
      setBusy(false)
    }
  }

  function openUnlockDialog() {
    setPassphrase('')
    setErrorText(null)
    setUnlockOpen(true)
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Label className="flex items-center gap-2">
          <CloudCog className="h-4 w-4" />
          {t('settings.title')}
        </Label>
        <p className="text-xs text-muted-foreground max-w-md">{t('settings.description')}</p>
        <p className="text-sm">
          {enabled ? t('settings.statusEnabled') : t('settings.statusDisabled')}
          {enabled && needsPassphrase && (
            <span className="ml-2 text-amber-600 dark:text-amber-400">
              {t('settings.statusLocked')}
            </span>
          )}
        </p>
        {enabled && lastError && (
          <p className="text-sm text-red-500 max-w-md">
            {t('settings.lastErrorPrefix')} {lastError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {!enabled && info?.onboarded && (
          <Button variant="outline" onClick={handleEnable} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('settings.enable')}
          </Button>
        )}
        {enabled && (
          <>
            <Button variant="outline" onClick={handleSyncNow} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {t('settings.syncNow')}
            </Button>
            <Button
              variant="outline"
              onClick={handleForcePublish}
              disabled={busy}
              title={t('settings.forcePublishHint')}
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CloudUpload className="mr-2 h-4 w-4" />
              )}
              {t('settings.forcePublish')}
            </Button>
            {needsPassphrase && (
              <Button variant="outline" onClick={openUnlockDialog} disabled={busy}>
                <KeyRound className="mr-2 h-4 w-4" />
                {t('settings.unlock')}
              </Button>
            )}
            <Button variant="outline" onClick={() => handleDisable(false)} disabled={busy}>
              {t('settings.stopPublishing')}
            </Button>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)} disabled={busy}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t('settings.deleteCloudData')}
            </Button>
          </>
        )}
      </div>

      <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('locked.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('locked.dialogDescription')}</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder={t('locked.placeholder')}
          />
          {errorText && <p className="text-sm text-red-500">{errorText}</p>}
          <DialogFooter>
            <Button onClick={handleUnlock} disabled={!passphrase || busy}>
              {t('locked.unlock')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              {t('settings.deleteTitle')}
            </DialogTitle>
            <DialogDescription>{t('settings.deleteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy}>
              {t('settings.deleteCancel')}
            </Button>
            <Button variant="destructive" onClick={() => handleDisable(true)} disabled={busy}>
              {t('settings.deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
