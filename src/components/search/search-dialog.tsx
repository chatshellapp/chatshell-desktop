import { useTranslation } from 'react-i18next'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useSearchStore } from '@/stores/searchStore'
import { formatConversationTimestamp } from '@/lib/utils'
import { HighlightedSnippet } from './highlighted-snippet'

export function SearchDialog() {
  const { t } = useTranslation('search')
  const isOpen = useSearchStore((s) => s.isOpen)
  const setOpen = useSearchStore((s) => s.setOpen)
  const query = useSearchStore((s) => s.query)
  const setQuery = useSearchStore((s) => s.setQuery)
  const search = useSearchStore((s) => s.search)
  const results = useSearchStore((s) => s.results)
  const isSearching = useSearchStore((s) => s.isSearching)
  const navigateToMessage = useSearchStore((s) => s.navigateToMessage)
  const clearSearch = useSearchStore((s) => s.clearSearch)

  const handleOpenChange = (open: boolean) => {
    setOpen(open)
    if (!open) clearSearch()
  }

  const handleValueChange = (value: string) => {
    setQuery(value)
    search(value)
  }

  const conversations = results?.conversations ?? []
  const messages = results?.messages ?? []
  const totalCount = results?.total_message_count ?? 0
  const searchTime = results?.search_time_ms ?? 0
  const hasResults = conversations.length > 0 || messages.length > 0
  const showEmpty = !isSearching && query.trim().length > 0 && !hasResults

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={t('placeholder')}
      description={t('placeholder')}
      className="max-h-[80vh]"
      shouldFilter={false}
    >
      <CommandInput
        placeholder={t('placeholder')}
        value={query}
        onValueChange={handleValueChange}
      />
      <CommandList className="max-h-[400px]">
        {showEmpty && <CommandEmpty>{t('noResults')}</CommandEmpty>}
        {conversations.length > 0 && (
          <CommandGroup heading={t('conversations')}>
            {conversations.map((c) => (
              <CommandItem
                key={c.id}
                value={`conv-${c.id}`}
                onSelect={async () => {
                  const { useConversationStore } = await import('@/stores/conversation')
                  await useConversationStore.getState().selectConversation(c.id)
                  setOpen(false)
                }}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <span className="font-medium truncate w-full">{c.title}</span>
                <span className="text-xs text-muted-foreground">
                  {c.updated_at ? formatConversationTimestamp(c.updated_at) : ''}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {messages.length > 0 && (
          <CommandGroup heading={t('messages')}>
            {messages.map((m) => (
              <CommandItem
                key={m.message_id}
                value={`msg-${m.message_id}`}
                onSelect={() => navigateToMessage(m.message_id, m.conversation_id)}
                className="flex flex-col items-start gap-1 py-2"
              >
                <span className="text-sm line-clamp-2 w-full">
                  <HighlightedSnippet text={m.content_snippet} />
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('inConversation', { title: m.conversation_title ?? '' })} ·{' '}
                  {m.created_at ? formatConversationTimestamp(m.created_at) : ''}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {hasResults && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground border-t">
            {t('stats', { count: totalCount, time: (searchTime / 1000).toFixed(2) })}
          </div>
        )}
      </CommandList>
    </CommandDialog>
  )
}
