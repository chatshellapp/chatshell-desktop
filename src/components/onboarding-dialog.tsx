import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Bot, BotIcon, CheckCircle2, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useModelStore } from '@/stores/modelStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSyncSetupStore } from '@/stores/syncSetupStore'
import { ProviderSettingsDialog } from '@/components/provider-settings-dialog'
import { SyncOnboardingCard } from '@/components/sync/sync-onboarding-card'

export function OnboardingDialog() {
  const { t } = useTranslation('onboarding')
  const { step, isDialogOpen, setStep, setDialogOpen } = useOnboardingStore()

  const { models, providers, loadAll: loadModelsAndProviders } = useModelStore()
  const { saveSetting, getSetting } = useSettingsStore()

  const [providerDialogOpen, setProviderDialogOpen] = useState(false)

  // Get active (non-deleted) models
  const activeModels = useMemo(() => models.filter((m) => !m.is_deleted), [models])
  // Models belonging to the auto-seeded local Ollama provider: the DB seed
  // detects a running Ollama instance on every startup and imports its
  // models, so presence here means "detected and auto-imported".
  const localModels = useMemo(
    () =>
      activeModels.filter((m) =>
        providers.some((p) => p.id === m.provider_id && p.provider_type === 'ollama')
      ),
    [activeModels, providers]
  )

  // Initial check when dialog opens
  useEffect(() => {
    if (isDialogOpen && step === 'checking') {
      performInitialCheck()
    }
  }, [isDialogOpen, step])

  async function performInitialCheck() {
    // First, check if onboarding was already completed
    const onboardingComplete = await getSetting('onboarding_complete')
    if (onboardingComplete === 'true') {
      setDialogOpen(false)
      return
    }

    // A running Ollama was detected and its models auto-imported by the
    // seed: acknowledge the import but keep the provider stage visible —
    // the user may still want other providers and models.
    if (localModels.length > 0) {
      setStep('local-ready')
      return
    }

    // Models from explicitly configured providers: the provider choice was
    // already made, so the provider stage is satisfied.
    if (activeModels.length > 0) {
      await proceedToSyncOrFinish()
      return
    }

    setStep('no-provider')
  }

  // When provider dialog closes, refresh data
  async function handleProviderDialogClose(open: boolean) {
    setProviderDialogOpen(open)
    if (!open) {
      // Refresh models after provider configuration
      await loadModelsAndProviders()
      const updatedModels = useModelStore.getState().models.filter((m) => !m.is_deleted)
      if (updatedModels.length > 0) {
        await proceedToSyncOrFinish()
      }
    }
  }

  // Provider stage satisfied (at least one usable model): persist
  // completion, then offer sync as the flow's final step (ADR 04 §7) when
  // the backend still wants the card.
  async function proceedToSyncOrFinish() {
    await saveSetting('onboarding_complete', 'true')

    const syncSetup = useSyncSetupStore.getState()
    if (!syncSetup.info) {
      await syncSetup.load()
    }
    if (useSyncSetupStore.getState().info?.needs_onboarding) {
      setStep('sync')
      return
    }
    setStep('complete')
    setDialogOpen(false)
  }

  // The sync card is the onboarding flow's final step: whatever the user
  // chose there (enable, join, or decline), the flow is done.
  function finishSyncStep() {
    setStep('complete')
    setDialogOpen(false)
  }

  function renderContent() {
    switch (step) {
      case 'checking':
        return (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="size-12 animate-spin text-primary" />
            <p className="text-lg font-medium">{t('settingUp')}</p>
            <p className="text-sm text-muted-foreground">{t('checkingForModels')}</p>
          </div>
        )

      case 'no-provider':
        return (
          <div className="flex flex-col items-center justify-center py-8 space-y-6">
            <div className="rounded-full bg-cyan-500/10 p-4">
              <BotIcon className="size-12 text-cyan-500" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold">{t('configureProvider')}</h3>
              <p className="text-muted-foreground max-w-md">{t('configureProviderDesc')}</p>
            </div>
            <Button onClick={() => setProviderDialogOpen(true)} size="lg">
              <Bot className="size-4 mr-2" />
              {t('setupProvider')}
              <ArrowRight className="size-4 ml-2" />
            </Button>
          </div>
        )

      case 'local-ready':
        return (
          <div className="flex flex-col items-center justify-center py-8 space-y-6">
            <div className="rounded-full bg-green-500/10 p-4">
              <CheckCircle2 className="size-12 text-green-500" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold">{t('ollamaReady')}</h3>
              <p className="text-muted-foreground max-w-md">
                {t('ollamaFoundModels', { count: localModels.length })}
              </p>
            </div>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <Button onClick={proceedToSyncOrFinish} size="lg">
                {t('continue')}
                <ArrowRight className="size-4 ml-2" />
              </Button>
              <Button variant="outline" onClick={() => setProviderDialogOpen(true)}>
                <Bot className="size-4 mr-2" />
                {t('addMoreProviders')}
              </Button>
            </div>
          </div>
        )

      case 'sync':
        return <SyncOnboardingCard onDone={finishSyncStep} />

      default:
        return null
    }
  }

  return (
    <>
      <Dialog open={isDialogOpen && step !== 'complete'} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg" showCloseButton={step !== 'sync'}>
          {step !== 'sync' && (
            <>
              <DialogTitle className="sr-only">{t('welcome')}</DialogTitle>
              <DialogDescription className="sr-only">
                Set up an AI provider to get started
              </DialogDescription>
            </>
          )}
          {renderContent()}
        </DialogContent>
      </Dialog>

      <ProviderSettingsDialog open={providerDialogOpen} onOpenChange={handleProviderDialogClose} />
    </>
  )
}
