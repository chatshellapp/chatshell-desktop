import { useState } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { SyncOnboardingCard } from '@/components/sync/sync-onboarding-card'
import { useSyncSetupStore } from '@/stores/syncSetupStore'
import { useOnboardingStore } from '@/stores/onboardingStore'

/**
 * Standalone launch-time sync onboarding dialog (ADR 04 §7) for sessions
 * where the general onboarding flow is not running — e.g. the re-ask at the
 * launch after a decline, or an existing user meeting the sync feature for
 * the first time. While the general onboarding flow owns the sync offer
 * (fresh install), the card renders as that flow's final step instead and
 * this dialog stays closed.
 *
 * A decline latches the dialog closed for the rest of the session even
 * though the backend keeps `needs_onboarding` true while the re-ask budget
 * lasts (once more at the NEXT launch, never a re-open in the same one).
 */
export function SyncOnboardingDialog() {
  const needsOnboarding = useSyncSetupStore((state) => Boolean(state.info?.needs_onboarding))
  const flowOwnsSyncOffer = useOnboardingStore((state) => state.flowOwnsSyncOffer)
  const [dismissed, setDismissed] = useState(false)

  const open = needsOnboarding && !flowOwnsSyncOffer && !dismissed

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <SyncOnboardingCard onDone={() => setDismissed(true)} />
      </DialogContent>
    </Dialog>
  )
}
