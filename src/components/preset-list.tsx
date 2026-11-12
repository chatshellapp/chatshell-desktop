import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, MoreVertical, SlidersHorizontal } from 'lucide-react'
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
import { summarizePreset } from '@/lib/preset-utils'
import type { ModelParameterPreset } from '@/types'

interface PresetListProps {
  presets: ModelParameterPreset[]
  selectedPresetId?: string
  onPresetClick: (preset: ModelParameterPreset) => void
  /** Double-click or Enter on a preset */
  onPresetActivate: (preset: ModelParameterPreset) => void
  onPresetSetDefault: (preset: ModelParameterPreset) => void
  /** Edit is offered for user presets only */
  onPresetEdit: (preset: ModelParameterPreset) => void
}

export function PresetList({
  presets,
  selectedPresetId,
  onPresetClick,
  onPresetActivate,
  onPresetSetDefault,
  onPresetEdit,
}: PresetListProps) {
  const { t } = useTranslation('sidebar')
  const builtIn = presets.filter((p) => p.is_system)
  const mine = presets.filter((p) => !p.is_system)

  const renderGroup = (title: string, items: ModelParameterPreset[]) => (
    <PresetGroup title={title}>
      {items.map((preset) => (
        <PresetListItem
          key={preset.id}
          preset={preset}
          isActive={selectedPresetId === preset.id}
          onClick={() => onPresetClick(preset)}
          onActivate={() => onPresetActivate(preset)}
          onSetDefault={() => onPresetSetDefault(preset)}
          onEdit={preset.is_system ? undefined : () => onPresetEdit(preset)}
        />
      ))}
    </PresetGroup>
  )

  return (
    <div className="flex flex-col gap-1">
      {mine.length > 0 ? (
        renderGroup(t('myPresets'), mine)
      ) : (
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SlidersHorizontal />
            </EmptyMedia>
            <EmptyTitle>{t('noCustomPresets')}</EmptyTitle>
            <EmptyDescription>{t('noCustomPresetsDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {builtIn.length > 0 && renderGroup(t('builtInPresets'), builtIn)}
    </div>
  )
}

function PresetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(true)
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
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
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-0.5 px-1 pb-1">{children}</CollapsibleContent>
    </Collapsible>
  )
}

interface PresetListItemProps {
  preset: ModelParameterPreset
  isActive: boolean
  onClick: () => void
  onActivate: () => void
  onSetDefault: () => void
  onEdit?: () => void
}

export function PresetListItem({
  preset,
  isActive,
  onClick,
  onActivate,
  onSetDefault,
  onEdit,
}: PresetListItemProps) {
  const { t } = useTranslation('sidebar')
  const { t: tCommon } = useTranslation('common')
  const summary = summarizePreset(preset)

  return (
    <Item
      className={cn(
        'group/preset cursor-pointer transition-colors hover:bg-accent/50',
        isActive && 'bg-accent'
      )}
      onClick={onClick}
      onDoubleClick={onActivate}
      tabIndex={0}
      role="button"
      size="sm"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (e.key === 'Enter') onActivate()
          else onClick()
        }
      }}
    >
      <ItemContent>
        <ItemHeader className="relative">
          <ItemTitle className="flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{preset.name}</span>
            {preset.is_default && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                {t('defaultPresetBadge')}
              </Badge>
            )}
          </ItemTitle>

          <div className="absolute right-0 top-1/2 -translate-y-1/2 rounded-md bg-accent opacity-0 transition-opacity group-hover/preset:opacity-100 focus-within:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  aria-label={t('moreActions')}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={onActivate}>{t('useInNewChat')}</DropdownMenuItem>
                {!preset.is_default && (
                  <DropdownMenuItem onClick={onSetDefault}>{t('setAsDefault')}</DropdownMenuItem>
                )}
                {onEdit && <DropdownMenuItem onClick={onEdit}>{tCommon('edit')}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ItemHeader>
        {(preset.description || summary) && (
          <ItemDescription>
            <span className="line-clamp-1 text-xs">{preset.description || summary}</span>
          </ItemDescription>
        )}
      </ItemContent>
    </Item>
  )
}
