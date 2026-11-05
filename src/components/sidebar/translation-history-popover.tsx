import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { TranslationHistoryEntry } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatConversationTimestamp } from '@/lib/utils'
import { AUTO_LANGUAGE, getDisplayName } from '@/lib/translationLanguages'
import {
  filterTranslationHistory,
  useTranslationHistoryStore,
} from '@/stores/translationHistoryStore'
import { useTranslationStore } from '@/stores/translationStore'

export function TranslationHistoryPopover({
  uiLocale,
  disabled,
}: {
  uiLocale: string
  disabled: boolean
}) {
  const { t } = useTranslation('sidebar')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)

  const entries = useTranslationHistoryStore((s) => s.entries)
  const enabled = useTranslationHistoryStore((s) => s.enabled)
  const ensureLoaded = useTranslationHistoryStore((s) => s.ensureLoaded)
  const remove = useTranslationHistoryStore((s) => s.remove)
  const clearAll = useTranslationHistoryStore((s) => s.clearAll)
  const setEnabled = useTranslationHistoryStore((s) => s.setEnabled)
  const restoreFromHistory = useTranslationStore((s) => s.restoreFromHistory)

  useEffect(() => {
    ensureLoaded()
  }, [ensureLoaded])

  const visibleEntries = useMemo(() => filterTranslationHistory(entries, query), [entries, query])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setQuery('')
  }

  const handleSelect = (entry: TranslationHistoryEntry) => {
    restoreFromHistory(entry)
    handleOpenChange(false)
  }

  const handleRemove = (id: string) => {
    remove(id).catch(() => toast.error(t('translationHistoryDeleteError')))
  }

  const handleClear = () => {
    clearAll().catch(() => toast.error(t('translationHistoryDeleteError')))
  }

  const languageLabel = (code: string) =>
    code === AUTO_LANGUAGE ? t('autoDetect') : getDisplayName(code, uiLocale)

  let emptyMessage: string | null = null
  if (entries.length === 0) {
    emptyMessage = enabled ? t('translationHistoryEmpty') : t('translationHistoryOff')
  } else if (visibleEntries.length === 0) {
    emptyMessage = t('common:noResults')
  }

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={t('translationHistory')}
            title={t('translationHistory')}
          >
            <History />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-96 flex-col gap-0 p-0">
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
            <h2 className="text-sm font-semibold">{t('translationHistory')}</h2>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t('translationHistorySave')}
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label={t('translationHistorySave')}
              />
            </label>
          </div>

          {entries.length > 0 && (
            <div className="relative border-b px-3 py-2">
              <Search className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('translationHistorySearch')}
                aria-label={t('translationHistorySearch')}
                className="h-8 pl-8"
              />
            </div>
          )}

          {emptyMessage ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1" aria-label={t('translationHistory')}>
              {visibleEntries.map((entry) => (
                <li key={entry.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => handleSelect(entry)}
                    className="flex w-full flex-col gap-1 px-3 py-2 pr-10 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="truncate">
                        {t('translationDirection', {
                          source: languageLabel(entry.source_language),
                          target: languageLabel(entry.target_language),
                        })}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">
                        {formatConversationTimestamp(entry.created_at)}
                      </span>
                    </span>
                    <span className="line-clamp-2 text-sm [overflow-wrap:anywhere]">
                      {entry.source_text}
                    </span>
                    <span className="line-clamp-2 text-sm [overflow-wrap:anywhere] text-muted-foreground">
                      {entry.translated_text}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1.5 right-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                    onClick={() => handleRemove(entry.id)}
                    aria-label={t('translationHistoryDelete')}
                    title={t('translationHistoryDelete')}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {entries.length > 0 && (
            <div className="flex justify-end border-t px-2 py-1.5">
              <Button variant="ghost" size="sm" onClick={() => setConfirmClearOpen(true)}>
                <Trash2 data-icon="inline-start" />
                {t('translationHistoryClear')}
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('translationHistoryClearTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('translationHistoryClearDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClear}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('translationHistoryClear')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
