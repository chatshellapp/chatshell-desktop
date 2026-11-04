// Bash environment settings (per device). Bash sessions start from an
// empty environment holding a fixed allowlist plus the variables listed
// here, so app secrets never leak into commands. Suggestions are common
// developer variables that are set in the app but not passed yet.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { Plus, SquareTerminal, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { logger } from '@/lib/logger'

interface BashEnvironmentView {
  allowlist: string[]
  passthrough: string[]
  suggestions: string[]
}

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export function BashEnvironment() {
  const { t } = useTranslation('settings')
  const [view, setView] = useState<BashEnvironmentView | null>(null)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    try {
      setView(await invoke<BashEnvironmentView>('get_bash_environment'))
    } catch (error) {
      logger.error('[BashEnvironment] get_bash_environment failed:', error)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (passthrough: string[]) => {
    try {
      setView(await invoke<BashEnvironmentView>('set_bash_environment', { passthrough }))
    } catch (error) {
      logger.error('[BashEnvironment] set_bash_environment failed:', error)
      toast.error(t('bashEnvironmentSaveFailed'))
    }
  }

  if (!view) return null

  const add = (name: string) => {
    const trimmed = name.trim()
    if (!VALID_NAME.test(trimmed)) {
      toast.error(t('bashEnvironmentInvalidName', { name: trimmed }))
      return
    }
    if (!view.passthrough.includes(trimmed)) {
      void save([...view.passthrough, trimmed])
    }
    setDraft('')
  }

  const removeName = (name: string) => {
    void save(view.passthrough.filter((entry) => entry !== name))
  }

  return (
    <div className="grid gap-3 rounded-lg border p-4 max-w-lg">
      <div className="flex items-start gap-3">
        <SquareTerminal className="h-5 w-5 text-muted-foreground mt-0.5" />
        <div className="grid gap-1">
          <span className="font-medium">{t('bashEnvironment')}</span>
          <p className="text-xs text-muted-foreground">{t('bashEnvironmentDescription')}</p>
        </div>
      </div>

      <div className="grid gap-1.5">
        <p className="text-xs text-muted-foreground">{t('bashEnvironmentAlways')}</p>
        <div className="flex flex-wrap gap-1.5">
          {view.allowlist.map((name) => (
            <Badge key={name} variant="outline" className="font-mono text-xs">
              {name}
            </Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        <p className="text-xs text-muted-foreground">{t('bashEnvironmentPassthrough')}</p>
        <div className="flex flex-wrap gap-1.5" data-testid="bash-env-passthrough">
          {view.passthrough.length === 0 && (
            <span className="text-xs text-muted-foreground">{t('bashEnvironmentNone')}</span>
          )}
          {view.passthrough.map((name) => (
            <Badge key={name} variant="secondary" className="gap-1 font-mono text-xs">
              {name}
              <button
                type="button"
                aria-label={t('bashEnvironmentRemove', { name })}
                onClick={() => removeName(name)}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            add(draft)
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="JAVA_HOME"
            aria-label={t('bashEnvironmentAddLabel')}
            className="h-8 font-mono text-xs"
          />
          <Button type="submit" variant="outline" size="sm" disabled={!draft.trim()}>
            {t('bashEnvironmentAdd')}
          </Button>
        </form>
      </div>

      {view.suggestions.length > 0 && (
        <div className="grid gap-1.5">
          <p className="text-xs text-muted-foreground">{t('bashEnvironmentSuggested')}</p>
          <div className="flex flex-wrap gap-1.5">
            {view.suggestions.map((name) => (
              <Button
                key={name}
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 font-mono text-xs"
                onClick={() => add(name)}
              >
                <Plus className="size-3" />
                {name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
