import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { KeyRound, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { syncErrorCopy } from '@/lib/sync-error'
import { useSyncSetupStore } from '@/stores/syncSetupStore'

/**
 * Non-blocking "history locked — enter sync passphrase" banner (ADR 04 §3
 * rule 2, rung 4). Launch is never blocked: the app renders local data and
 * this explanatory placeholder until unlock.
 */
export function SyncLockedBanner() {
  const { t } = useTranslation('sync')
  const { lockedEvent, unlock } = useSyncSetupStore()
  const [open, setOpen] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  if (!lockedEvent) return null

  async function handleUnlock() {
    setBusy(true)
    setErrorText(null)
    try {
      await unlock(passphrase)
      setPassphrase('')
      setOpen(false)
      toast.success(t('locked.unlocked'))
    } catch (err) {
      setErrorText(syncErrorCopy(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 shrink-0" />
          <span>{t('locked.banner')}</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <KeyRound className="mr-2 h-4 w-4" />
          {t('locked.action')}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('locked.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('locked.dialogDescription')}</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && passphrase && handleUnlock()}
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
    </>
  )
}
