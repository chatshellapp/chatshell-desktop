import * as React from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PromptListItem } from '@/components/prompt-list-item'

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
   * Click handler for prompt settings
   */
  onPromptSettings?: (prompt: Prompt) => void
  /**
   * Click handler for prompt star toggle
   */
  onPromptStarToggle?: (prompt: Prompt) => void
  /**
   * Click handler for group settings
   */
  onGroupSettings?: (group: PromptGroup) => void
  /**
   * Optional className for customization
   */
  className?: string
}

export function PromptList({
  groups,
  selectedPromptId,
  onPromptClick,
  onPromptSettings,
  onPromptStarToggle,
  onGroupSettings,
  className,
}: PromptListProps) {
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
    name: 'Starred',
    prompts: starredPrompts,
    defaultOpen: true,
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {/* Show starred prompts group first if there are any starred prompts */}
      {hasStarredPrompts && (
        <PromptGroupComponent
          group={starredGroup}
          selectedPromptId={selectedPromptId}
          onPromptClick={onPromptClick}
          onPromptSettings={onPromptSettings}
          onPromptStarToggle={onPromptStarToggle}
          onGroupSettings={onGroupSettings}
          hideGroupMenu
          forceDefaultOpen
        />
      )}

      {/* Show all other prompt groups */}
      {groups.map((group, index) => (
        <PromptGroupComponent
          key={group.id}
          group={group}
          selectedPromptId={selectedPromptId}
          onPromptClick={onPromptClick}
          onPromptSettings={onPromptSettings}
          onPromptStarToggle={onPromptStarToggle}
          onGroupSettings={onGroupSettings}
          forceDefaultOpen={!hasStarredPrompts && index === 0}
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
  onPromptSettings?: (prompt: Prompt) => void
  onPromptStarToggle?: (prompt: Prompt) => void
  onGroupSettings?: (group: PromptGroup) => void
  hideGroupMenu?: boolean
  forceDefaultOpen?: boolean
  ignoreGroupDefault?: boolean
}

function PromptGroupComponent({
  group,
  selectedPromptId,
  onPromptClick,
  onPromptSettings,
  onPromptStarToggle,
  onGroupSettings,
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
            <span className="flex-1 text-left">{group.name}</span>
          </Button>
        </CollapsibleTrigger>

        {/* Group menu button */}
        {!hideGroupMenu && (
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
                    onGroupSettings?.(group)
                  }}
                >
                  Configuration
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
            isActive={selectedPromptId === prompt.id}
            onClick={() => onPromptClick?.(prompt)}
            onSettingsClick={() => onPromptSettings?.(prompt)}
            onStarClick={() => onPromptStarToggle?.(prompt)}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
