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
 */
export function SyncOnboardingDialog() {
  const needsOnboarding = useSyncSetupStore((state) => Boolean(state.info?.needs_onboarding))
  const flowOwnsSyncOffer = useOnboardingStore((state) => state.flowOwnsSyncOffer)

  const open = needsOnboarding && !flowOwnsSyncOffer

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <SyncOnboardingCard />
      </DialogContent>
    </Dialog>
  )
}
