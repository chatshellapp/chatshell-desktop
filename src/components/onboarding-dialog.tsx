import { useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, Sparkles, Bot, ArrowRight, BotIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useModelStore } from '@/stores/ModelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { usePromptStore } from '@/stores/PromptStore'
import { useSettingsStore } from '@/stores/SettingsStore'
import { ProviderSettingsDialog } from '@/components/provider-settings-dialog'
import { generateRandomAvatarData } from '@/lib/assistant-utils'
import type { CreateAssistantRequest } from '@/types'
import { logger } from '@/lib/logger'

export function OnboardingDialog() {
  const { step, isDialogOpen, ollamaModels, checkOllama, setStep, setDialogOpen } =
    useOnboardingStore()

  const { models, providers, loadAll: loadModelsAndProviders } = useModelStore()
  const { assistants, createAssistant } = useAssistantStore()
  const { prompts, ensureLoaded: ensurePromptsLoaded } = usePromptStore()
  const { saveSetting, getSetting } = useSettingsStore()

  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [isCreatingAssistant, setIsCreatingAssistant] = useState(false)

  // Get active (non-deleted) models
  const activeModels = useMemo(() => models.filter((m) => !m.is_deleted), [models])

  // Check if we have Ollama models in the database
  const hasOllamaModels = useMemo(() => {
    return activeModels.some((m) => {
      const provider = providers.find((p) => p.id === m.provider_id)
      return provider?.provider_type === 'ollama'
    })
  }, [activeModels, providers])

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

    // Check if we already have assistants
    if (assistants.length > 0) {
      await saveSetting('onboarding_complete', 'true')
      setDialogOpen(false)
      return
    }

    // Check if Ollama is running and has models
    const ollamaAvailable = await checkOllama()

    if (ollamaAvailable || hasOllamaModels) {
      setStep('ollama-detected')
    } else if (activeModels.length > 0) {
      // Has models from other providers
      setStep('creating-assistant')
    } else {
      setStep('no-provider')
    }
  }

  // When provider dialog closes, refresh data
  async function handleProviderDialogClose(open: boolean) {
    setProviderDialogOpen(open)
    if (!open) {
      // Refresh models after provider configuration
      await loadModelsAndProviders()

      // Check if models were added
      const updatedModels = useModelStore.getState().models.filter((m) => !m.is_deleted)
      if (updatedModels.length > 0) {
        setStep('creating-assistant')
      }
    }
  }

  // Helper to get a random model ID
  function getRandomModelId(): string {
    if (activeModels.length === 1) {
      return activeModels[0].id
    }
    const randomIndex = Math.floor(Math.random() * activeModels.length)
    return activeModels[randomIndex].id
  }

  async function createDefaultAssistants() {
    setIsCreatingAssistant(true)

    try {
      await ensurePromptsLoaded()

      // Get all built-in prompts
      const builtInPrompts = prompts.filter((p) => p.is_system)

      if (builtInPrompts.length === 0) {
        // Fallback: create a single default assistant if no prompts exist
        const { name, emoji, color } = generateRandomAvatarData()
        const req: CreateAssistantRequest = {
          name,
          role: 'AI Assistant',
          description: 'Your helpful AI assistant',
          system_prompt: 'You are a helpful AI assistant.',
          model_id: getRandomModelId(),
          avatar_type: 'text',
          avatar_bg: color,
          avatar_text: emoji,
          is_starred: true,
        }
        await createAssistant(req)
      } else {
        // Create an assistant for each prompt
        for (const prompt of builtInPrompts) {
          const { name, emoji, color } = generateRandomAvatarData()

          const req: CreateAssistantRequest = {
            name,
            role: prompt.name, // Use prompt title as role
            description: prompt.description || undefined,
            system_prompt: prompt.content,
            model_id: getRandomModelId(),
            avatar_type: 'text',
            avatar_bg: color,
            avatar_text: emoji,
            group_name: prompt.category || undefined,
            is_starred: false,
          }

          await createAssistant(req)
        }
      }

      // Mark onboarding as complete
      await saveSetting('onboarding_complete', 'true')

      // Show success toast
      const count = builtInPrompts.length || 1
      toast.success('All set!', {
        description: `${count} assistant${count !== 1 ? 's' : ''} AI assistants ready. Pick one to start chatting!`,
        duration: 5000,
      })

      setStep('complete')
      setDialogOpen(false)
    } catch (err) {
      logger.error('Failed to create assistants:', err)
      toast.error('Failed to create assistants', {
        description: String(err),
      })
    } finally {
      setIsCreatingAssistant(false)
    }
  }

  function renderContent() {
    switch (step) {
      case 'checking':
        return (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="size-12 animate-spin text-primary" />
            <p className="text-lg font-medium">Setting up ChatShell...</p>
            <p className="text-sm text-muted-foreground">Checking for local AI models</p>
          </div>
        )

      case 'ollama-detected':
        return (
          <div className="flex flex-col items-center justify-center py-8 space-y-6">
            <div className="rounded-full bg-green-500/10 p-4">
              <CheckCircle2 className="size-12 text-green-500" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold">Ollama is ready</h3>
              <p className="text-muted-foreground max-w-md">
                Found {ollamaModels.length} local model{ollamaModels.length !== 1 ? 's' : ''}. Your
                AI runs on your machine - fast and private.
              </p>
            </div>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <Button onClick={createDefaultAssistants} disabled={isCreatingAssistant}>
                {isCreatingAssistant ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4 mr-2" />
                    Create Assistants
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={() => setProviderDialogOpen(true)}>
                <Bot className="size-4 mr-2" />
                Add More Providers
              </Button>
            </div>
          </div>
        )

      case 'no-provider':
        return (
          <div className="flex flex-col items-center justify-center py-8 space-y-6">
            <div className="rounded-full bg-cyan-500/10 p-4">
              <BotIcon className="size-12 text-cyan-500" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold">Configure a provider to get started</h3>
              <p className="text-muted-foreground max-w-md">
                To start chatting, you'll need to configure an AI provider. Choose from local
                options like Ollama or cloud services like OpenAI and OpenRouter.
              </p>
            </div>
            <Button onClick={() => setProviderDialogOpen(true)} size="lg">
              <Bot className="size-4 mr-2" />
              Configure Provider
              <ArrowRight className="size-4 ml-2" />
            </Button>
          </div>
        )

      case 'creating-assistant':
        return (
          <div className="flex flex-col items-center justify-center py-8 space-y-6">
            <div className="rounded-full bg-pink-500/10 p-4">
              <Sparkles className="size-12 text-pink-500" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold">Ready to create your assistants</h3>
              <p className="text-muted-foreground max-w-md">
                You have {activeModels.length} model{activeModels.length !== 1 ? 's' : ''}{' '}
                available. Assistants will be created from built-in prompts.
              </p>
            </div>
            <Button onClick={createDefaultAssistants} disabled={isCreatingAssistant} size="lg">
              {isCreatingAssistant ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="size-4 mr-2" />
                  Create Assistants
                </>
              )}
            </Button>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <>
      <Dialog open={isDialogOpen && step !== 'complete'} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle className="sr-only">Welcome to ChatShell</DialogTitle>
          <DialogDescription className="sr-only">
            Set up your AI assistant to get started
          </DialogDescription>
          {renderContent()}
        </DialogContent>
      </Dialog>

      <ProviderSettingsDialog open={providerDialogOpen} onOpenChange={handleProviderDialogClose} />
    </>
  )
}
