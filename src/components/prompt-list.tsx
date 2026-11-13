import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, MoreVertical, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PromptListItem } from '@/components/prompt-list-item'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RenameDialog } from '@/components/message-list-item/rename-dialog'
import { UNCATEGORIZED_CATEGORY } from '@/lib/prompt-utils'

export interface Prompt {
  /**
   * Unique identifier for the prompt
   */
  id: string
  /**
   * Display name of the prompt
   */
  name: string
  /**
   * Content/description of the prompt
   */
  content: string
  /**
   * Whether the prompt is starred/favorited
   */
  isStarred?: boolean
  /**
   * Whether the prompt is a system prompt
   */
  isSystem?: boolean
}

export interface PromptGroup {
  /**
   * Unique identifier for the group
   */
  id: string
  /**
   * Group name (user-created)
   */
  name: string
  /**
   * List of prompts in this group
   */
  prompts: Prompt[]
  /**
   * Whether the group is initially open
   */
  defaultOpen?: boolean
}

interface PromptListProps {
  /**
   * List of prompt groups
   */
  groups: PromptGroup[]
  /**
   * Currently selected prompt ID
   */
  selectedPromptId?: string
  /**
   * Click handler for prompt selection
   */
  onPromptClick?: (prompt: Prompt) => void
  /**
   * Double-click or Enter on a prompt
   */
  onPromptActivate?: (prompt: Prompt) => void
  /**
   * Click handler for prompt settings
   */
  onPromptSettings?: (prompt: Prompt) => void
  /**
   * Click handler for prompt star toggle
   */
  onPromptStarToggle?: (prompt: Prompt) => void
  /**
   * Click handler for prompt delete
   */
  onPromptDelete?: (prompt: Prompt) => void
  /**
   * Rename a category, or clear it on its prompts when the new name is empty.
   * The group menu is hidden when absent.
   */
  onGroupRename?: (group: PromptGroup, newName: string) => void
  /**
   * A sidebar filter is active: every group opens and the Starred group is
   * hidden (it would repeat matches already shown in their own groups)
   */
  filtering?: boolean
  /**
   * Optional className for customization
   */
  className?: string
}

export function PromptList({
  groups,
  selectedPromptId,
  onPromptClick,
  onPromptActivate,
  onPromptSettings,
  onPromptStarToggle,
  onPromptDelete,
  onGroupRename,
  className,
  filtering = false,
}: PromptListProps) {
  const { t } = useTranslation('prompts')
  const { t: tSidebar } = useTranslation('sidebar')
  // Collect all starred prompts from all groups
  const starredPrompts = React.useMemo(() => {
    const prompts: Prompt[] = []
    groups.forEach((group) => {
      group.prompts.forEach((prompt) => {
        if (prompt.isStarred) {
          prompts.push(prompt)
        }
      })
    })
    return prompts
  }, [groups])

  const hasStarredPrompts = starredPrompts.length > 0

  // Create a virtual group for starred prompts
  const starredGroup: PromptGroup = {
    id: 'starred',
    name: tSidebar('starred'),
    prompts: starredPrompts,
    defaultOpen: true,
  }

  // Check if there are any prompts at all
  const totalPrompts = groups.reduce((acc, group) => acc + group.prompts.length, 0)

  if (totalPrompts === 0) {
    return (
      <Empty className={className}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Sparkles />
          </EmptyMedia>
          <EmptyTitle>{t('noPrompts')}</EmptyTitle>
          <EmptyDescription>{t('createFirstPrompt')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {/* Show starred prompts group first if there are any starred prompts */}
      {hasStarredPrompts && !filtering && (
        <PromptGroupComponent
          group={starredGroup}
          selectedPromptId={selectedPromptId}
          onPromptClick={onPromptClick}
          onPromptActivate={onPromptActivate}
          onPromptSettings={onPromptSettings}
          onPromptStarToggle={onPromptStarToggle}
          onPromptDelete={onPromptDelete}
          onGroupRename={onGroupRename}
          hideGroupMenu
          forceDefaultOpen
        />
      )}

      {/* Show all other prompt groups */}
      {groups.map((group, index) => (
        <PromptGroupComponent
          key={filtering ? `${group.id}:filtering` : group.id}
          group={group}
          selectedPromptId={selectedPromptId}
          onPromptClick={onPromptClick}
          onPromptActivate={onPromptActivate}
          onPromptSettings={onPromptSettings}
          onPromptStarToggle={onPromptStarToggle}
          onPromptDelete={onPromptDelete}
          onGroupRename={onGroupRename}
          forceDefaultOpen={filtering || (!hasStarredPrompts && index === 0)}
          ignoreGroupDefault={hasStarredPrompts}
        />
      ))}
    </div>
  )
}

interface PromptGroupComponentProps {
  group: PromptGroup
  selectedPromptId?: string
  onPromptClick?: (prompt: Prompt) => void
  onPromptActivate?: (prompt: Prompt) => void
  onPromptSettings?: (prompt: Prompt) => void
  onPromptStarToggle?: (prompt: Prompt) => void
  onPromptDelete?: (prompt: Prompt) => void
  onGroupRename?: (group: PromptGroup, newName: string) => void
  hideGroupMenu?: boolean
  forceDefaultOpen?: boolean
  ignoreGroupDefault?: boolean
}

function PromptGroupComponent({
  group,
  selectedPromptId,
  onPromptClick,
  onPromptActivate,
  onPromptSettings,
  onPromptStarToggle,
  onPromptDelete,
  onGroupRename,
  hideGroupMenu = false,
  forceDefaultOpen = false,
  ignoreGroupDefault = false,
}: PromptGroupComponentProps) {
  // Determine initial open state:
  // - If forceDefaultOpen is true, always open
  // - If ignoreGroupDefault is true, ignore group.defaultOpen (use false)
  // - Otherwise use group.defaultOpen, default to false
  const initialOpenState = forceDefaultOpen || (!ignoreGroupDefault && (group.defaultOpen ?? false))
  const [isOpen, setIsOpen] = React.useState(initialOpenState)
  const [isHovered, setIsHovered] = React.useState(false)
  const [showRenameDialog, setShowRenameDialog] = React.useState(false)
  const { t } = useTranslation('sidebar')
  const isUncategorized = group.name === UNCATEGORIZED_CATEGORY
  // The virtual "Uncategorized" bucket has no name to edit
  const showGroupMenu = !hideGroupMenu && !isUncategorized && !!onGroupRename

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className="group/group-header relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start font-normal text-sm h-9 px-3"
          >
            <ChevronDown
              className={cn('size-4 transition-transform duration-200', !isOpen && '-rotate-90')}
            />
            <span className="flex-1 text-left">
              {isUncategorized ? t('uncategorized') : group.name}
            </span>
          </Button>
        </CollapsibleTrigger>

        {/* Group menu button */}
        {showGroupMenu && (
          <div
            className={cn(
              'absolute right-2 top-1/2 -translate-y-1/2 transition-opacity',
              !isHovered && 'opacity-0'
            )}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  onClick={(e) => {
                    e.stopPropagation()
                  }}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowRenameDialog(true)
                  }}
                >
                  {t('renameCategory')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onGroupRename?.(group, '')
                  }}
                >
                  {t('uncategorizePrompts')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <CollapsibleContent className="space-y-0.5 px-1 pb-1">
        {group.prompts.map((prompt) => (
          <PromptListItem
            key={prompt.id}
            name={prompt.name}
            content={prompt.content}
            isStarred={prompt.isStarred}
            isSystem={prompt.isSystem}
            isActive={selectedPromptId === prompt.id}
            onClick={() => onPromptClick?.(prompt)}
            onActivate={onPromptActivate ? () => onPromptActivate(prompt) : undefined}
            onSettingsClick={() => onPromptSettings?.(prompt)}
            onStarClick={() => onPromptStarToggle?.(prompt)}
            onDeleteClick={onPromptDelete ? () => onPromptDelete(prompt) : undefined}
          />
        ))}
      </CollapsibleContent>

      {showGroupMenu && (
        <RenameDialog
          open={showRenameDialog}
          onOpenChange={setShowRenameDialog}
          currentTitle={group.name}
          onRename={(newName) => onGroupRename?.(group, newName)}
          title={t('renameCategory')}
          description={t('renameCategoryDescription')}
          placeholder={t('categoryNamePlaceholder')}
        />
      )}
    </Collapsible>
  )
}
