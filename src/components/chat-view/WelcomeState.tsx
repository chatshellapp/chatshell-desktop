import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowRight, FolderSearch, Globe, Lightbulb, PenLine, Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConversationStore } from '@/stores/conversation'
import { useModelStore } from '@/stores/modelStore'
import { useProviderSettingsStore } from '@/stores/providerSettingsStore'

const STARTERS = [
  { id: 'search', icon: Globe },
  { id: 'files', icon: FolderSearch },
  { id: 'write', icon: PenLine },
  { id: 'explain', icon: Lightbulb },
] as const

interface WelcomeStateProps {
  /** A model or assistant is selected, so the composer can send */
  canChat: boolean
}

/**
 * Body of an empty conversation. Starters prefill the composer instead of
 * sending, so the user can read and adjust the prompt first. Without a
 * usable model the composer is disabled, so the way out is offered here.
 */
export function WelcomeState({ canChat }: WelcomeStateProps) {
  const { t } = useTranslation('chat')
  const setPendingInput = useConversationStore((state) => state.setPendingInput)
  const openProviderSettings = useProviderSettingsStore((state) => state.openProviderSettings)
  const hasModels = useModelStore((state) => state.models.some((m) => !m.is_deleted))

  if (!canChat && hasModels) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-12 text-center">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">{t('welcome.pickModelTitle')}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{t('welcome.pickModelBody')}</p>
        </div>
        <ArrowDown className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (!canChat) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
          <Plug className="size-6 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">{t('welcome.noModelTitle')}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{t('welcome.noModelBody')}</p>
        </div>
        <Button onClick={() => openProviderSettings()}>
          {t('welcome.connectModel')}
          <ArrowRight />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">{t('welcome.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('welcome.subtitle')}</p>
      </div>
      <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {STARTERS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            data-starter={id}
            onClick={() => setPendingInput(t(`welcome.starters.${id}.prompt`))}
            className="group flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/20 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 space-y-1">
              <span className="block text-sm font-medium">{t(`welcome.starters.${id}.title`)}</span>
              <span className="line-clamp-2 block text-xs text-muted-foreground">
                {t(`welcome.starters.${id}.prompt`)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
