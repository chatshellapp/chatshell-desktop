import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CloudCog, KeyRound, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSyncSetupStore } from '@/stores/syncSetupStore'

/**
 * Settings surface for sync enablement (ADR 04 §7): status, re-enable,
 * two-tier disable (stop publishing — default, peers untouched — versus
 * delete my cloud data, destructive and separately confirmed), and explicit
 * content-key rotation (suspected compromise / lost device; forward-only).
 */
export function SyncSettingsSection() {
  const { t } = useTranslation('sync')
  const { info, enable, disable, rotateKey } = useSyncSetupStore()
  const [busy, setBusy] = useState(false)
  const [rotateOpen, setRotateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [passphrase, setPassphrase] = useState('')

  const enabled = info?.enabled ?? false
  const needsPassphrase = info?.needsPassphrase ?? false

  async function handleEnable() {
    setBusy(true)
    try {
      await enable()
      toast.success(t('settings.enabled'))
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

  async function handleRotate() {
    setBusy(true)
    try {
      const summary = await rotateKey(passphrase)
      toast.info(summary)
      setRotateOpen(false)
      setPassphrase('')
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(false)
    }
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
            <Button variant="outline" onClick={() => handleDisable(false)} disabled={busy}>
              {t('settings.stopPublishing')}
            </Button>
            <Button variant="outline" onClick={() => setRotateOpen(true)} disabled={busy}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {t('settings.rotateKey')}
            </Button>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)} disabled={busy}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t('settings.deleteCloudData')}
            </Button>
          </>
        )}
      </div>

      <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.rotateTitle')}</DialogTitle>
            <DialogDescription>{t('settings.rotateDescription')}</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder={t('locked.placeholder')}
          />
          <DialogFooter>
            <Button onClick={handleRotate} disabled={!passphrase || busy}>
              {t('settings.rotateConfirm')}
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
