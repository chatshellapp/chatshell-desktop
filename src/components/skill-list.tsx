import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, CloudDownload, MoreVertical, Zap } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Item, ItemContent, ItemDescription, ItemHeader, ItemTitle } from '@/components/ui/item'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { cn } from '@/lib/utils'
import { SKILL_SOURCE_ORDER, isSkillAvailable, type Skill } from '@/types'

interface SkillListProps {
  skills: Skill[]
  selectedSkillId?: string
  onSkillClick: (skill: Skill) => void
  onSkillToggle: (skill: Skill) => void
}

/**
 * Library > Skills: every indexed skill, grouped by source. Filtering is the
 * sidebar header filter's job; `skills` arrives already filtered.
 */
export function SkillList({
  skills,
  selectedSkillId,
  onSkillClick,
  onSkillToggle,
}: SkillListProps) {
  const { t } = useTranslation('skills')

  // ChatShell's own skills first: they are the ones managed here.
  const order: string[] = ['user', ...SKILL_SOURCE_ORDER.filter((s) => s !== 'user')]
  const sources = [
    ...order,
    ...new Set(skills.map((s) => s.source).filter((s) => !order.includes(s))),
  ]

  if (skills.length === 0) {
    return (
      <Empty className="py-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Zap />
          </EmptyMedia>
          <EmptyTitle>{t('noSkills')}</EmptyTitle>
          <EmptyDescription>{t('noSkillsDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {sources.map((source) => {
        const group = skills.filter((s) => s.source === source)
        if (group.length === 0) return null
        return (
          <SkillGroup
            key={source}
            title={t(`sourceLabels.${source}` as never, { defaultValue: source })}
            count={group.length}
          >
            {group.map((skill) => (
              <SkillListItem
                key={skill.id}
                skill={skill}
                isActive={selectedSkillId === skill.id}
                onClick={() => onSkillClick(skill)}
                onToggle={() => onSkillToggle(skill)}
              />
            ))}
          </SkillGroup>
        )
      })}
    </div>
  )
}

function SkillGroup({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = React.useState(true)
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="min-w-0">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-full justify-start px-3 text-sm font-normal"
        >
          <ChevronDown
            className={cn('size-4 transition-transform duration-200', !isOpen && '-rotate-90')}
          />
          <span className="flex-1 text-left">{title}</span>
          <span className="text-xs text-muted-foreground">{count}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 space-y-0.5 px-1 pb-1">{children}</CollapsibleContent>
    </Collapsible>
  )
}

interface SkillListItemProps {
  skill: Skill
  isActive: boolean
  onClick: () => void
  onToggle: () => void
}

export function SkillListItem({ skill, isActive, onClick, onToggle }: SkillListItemProps) {
  const { t } = useTranslation('skills')
  const { t: tSidebar } = useTranslation('sidebar')
  const available = isSkillAvailable(skill)

  return (
    <Item
      className={cn(
        'group/skill w-full min-w-0 cursor-pointer transition-colors hover:bg-accent/50',
        isActive && 'bg-accent'
      )}
      onClick={onClick}
      tabIndex={0}
      role="button"
      size="sm"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          // Skills have no "use" action: the model picks enabled skills up
          // by itself, so every gesture just opens the detail page.
          e.preventDefault()
          onClick()
        }
      }}
    >
      <ItemContent className="min-w-0">
        <ItemHeader className="relative min-w-0">
          <ItemTitle
            className={cn(
              // A definite zero width keeps the name's nowrap text out of the
              // min-content size; min-w-0 alone still lets it widen the
              // sidebar (WebKit). flex-1 fills the row.
              'w-0 min-w-0 flex-1 text-sm font-medium',
              !skill.is_enabled && 'text-muted-foreground'
            )}
          >
            {skill.icon ? (
              <span className="size-4 shrink-0 text-center leading-4">{skill.icon}</span>
            ) : (
              <Zap className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{skill.name}</span>
            {!available && (
              <CloudDownload
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label={t('notOnThisDevice')}
              />
            )}
            {!skill.is_enabled && (
              <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
                {t('disabled')}
              </Badge>
            )}
          </ItemTitle>

          <div className="absolute right-0 top-1/2 -translate-y-1/2 rounded-md bg-accent opacity-0 transition-opacity group-hover/skill:opacity-100 focus-within:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  aria-label={tSidebar('moreActions')}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={onToggle}>
                  {skill.is_enabled ? t('disable') : t('enable')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ItemHeader>
        {skill.description && (
          <ItemDescription>
            <span className="line-clamp-1 break-words text-xs">{skill.description}</span>
          </ItemDescription>
        )}
      </ItemContent>
    </Item>
  )
}
