import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, MoreHorizontal, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, formatConversationTimestamp } from '@/lib/utils'
import type { Conversation } from '@/types'

/**
 * Building blocks for the main-pane detail pages shown when an item is
 * selected in a sidebar section (contact profiles, library prompts).
 */

/**
 * Scrollable page frame shared by every detail page
 */
export function DetailPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto" data-testid="detail-page">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">{children}</div>
    </div>
  )
}

export interface DetailPrimaryAction {
  label: string
  icon: React.ReactNode
  onClick: () => void
}

interface DetailHeaderProps {
  avatar: React.ReactNode
  name: string
  subtitle?: string
  /** Small badges under the subtitle (provider, group, ...) */
  badges?: React.ReactNode
  /** Main call to action, rendered as the filled button */
  primaryAction: DetailPrimaryAction
  /** Extra icon buttons placed between the star and the menu */
  extraActions?: React.ReactNode
  /** Star toggle is shown only when onStarToggle is provided */
  isStarred?: boolean
  onStarToggle?: () => void
  /** Dropdown menu items for secondary actions */
  menuItems?: React.ReactNode
}

export function DetailHeader({
  avatar,
  name,
  subtitle,
  badges,
  primaryAction,
  extraActions,
  isStarred = false,
  onStarToggle,
  menuItems,
}: DetailHeaderProps) {
  const { t } = useTranslation('sidebar')

  return (
    <header className="flex flex-col items-center gap-4 text-center">
      {avatar}
      <div className="flex min-w-0 flex-col items-center gap-1">
        <h2 className="max-w-full truncate text-2xl font-semibold">{name}</h2>
        {subtitle && <p className="max-w-lg text-sm text-muted-foreground">{subtitle}</p>}
        {badges && <div className="mt-1 flex flex-wrap justify-center gap-1.5">{badges}</div>}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={primaryAction.onClick}>
          {primaryAction.icon}
          {primaryAction.label}
        </Button>
        {onStarToggle && (
          <Button
            variant="outline"
            size="icon"
            onClick={onStarToggle}
            aria-pressed={isStarred}
            aria-label={isStarred ? t('unstar') : t('star')}
            title={isStarred ? t('unstar') : t('star')}
            className={cn(isStarred && 'text-star hover:text-star/80')}
          >
            <Star className={cn(isStarred && 'fill-current')} />
          </Button>
        )}
        {extraActions}
        {menuItems && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('moreActions')}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">{menuItems}</DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  )
}

export function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

export interface DetailItem {
  label: string
  value: React.ReactNode
}

/**
 * Label/value rows; rows whose value is empty are skipped
 */
export function DetailList({ items }: { items: DetailItem[] }) {
  const visible = items.filter(
    (item) => item.value !== undefined && item.value !== null && item.value !== ''
  )
  if (visible.length === 0) return null
  return (
    <dl className="divide-y rounded-lg border">
      {visible.map((item) => (
        <div key={item.label} className="flex gap-4 px-4 py-2.5 text-sm">
          <dt className="w-32 shrink-0 text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 flex-1 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Long text that collapses to a few lines with a toggle
 */
export function CollapsibleText({ text }: { text: string }) {
  const { t } = useTranslation('sidebar')
  const [expanded, setExpanded] = React.useState(false)
  const isLong = text.length > 280 || text.split('\n').length > 6

  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border bg-muted/30 px-4 py-3">
      <p
        className={cn(
          'w-full whitespace-pre-wrap break-words font-mono text-xs leading-relaxed',
          isLong && !expanded && 'line-clamp-6'
        )}
      >
        {text}
      </p>
      {isLong && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('showLess') : t('showMore')}
        </Button>
      )}
    </div>
  )
}

interface RecentConversationsProps {
  conversations: Conversation[]
  isLoading: boolean
  onOpen: (conversationId: string) => void
  /** Text shown when the list is empty; defaults to the contact wording */
  emptyText?: string
}

export function RecentConversations({
  conversations,
  isLoading,
  onOpen,
  emptyText,
}: RecentConversationsProps) {
  const { t } = useTranslation('sidebar')

  if (conversations.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        {isLoading ? t('common:loading') : (emptyText ?? t('noRecentConversations'))}
      </p>
    )
  }

  return (
    <ul className="divide-y rounded-lg border">
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <button
            type="button"
            onClick={() => onOpen(conversation.id)}
            className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
          >
            <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">
                {conversation.title || t('newConversation')}
              </span>
              {conversation.last_message && (
                <span className="truncate text-xs text-muted-foreground">
                  {conversation.last_message}
                </span>
              )}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatConversationTimestamp(conversation.updated_at)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
