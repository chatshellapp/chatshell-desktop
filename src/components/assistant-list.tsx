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
import { AssistantListItem, AssistantCapabilities } from '@/components/assistant-list-item'

export interface Assistant {
  /**
   * Unique identifier for the assistant
   */
  id: string
  /**
   * Display name of the assistant (nickname)
   */
  name: string
  /**
   * Persona/role description of the assistant
   */
  persona?: string
  /**
   * Model name to display
   */
  modelName?: string
  /**
   * URL or path to the assistant logo image
   */
  logo?: string
  /**
   * Background color for the avatar (e.g., "#3b82f6", "bg-blue-500")
   */
  avatarBg?: string
  /**
   * Text or emoji to display in the avatar when no logo is provided
   */
  avatarText?: string
  /**
   * Assistant capabilities
   */
  capabilities?: AssistantCapabilities
  /**
   * Whether the assistant is starred
   */
  isStarred?: boolean
}

export interface AssistantGroup {
  /**
   * Unique identifier for the group
   */
  id: string
  /**
   * Group name (user-created)
   */
  name: string
  /**
   * List of assistants in this group
   */
  assistants: Assistant[]
  /**
   * Whether the group is initially open
   */
  defaultOpen?: boolean
}

interface AssistantListProps {
  /**
   * List of assistant groups
   */
  groups: AssistantGroup[]
  /**
   * Currently selected assistant ID
   */
  selectedAssistantId?: string
  /**
   * Click handler for assistant selection
   */
  onAssistantClick?: (assistant: Assistant) => void
  /**
   * Click handler for assistant settings
   */
  onAssistantSettings?: (assistant: Assistant) => void
  /**
   * Click handler for assistant star toggle
   */
  onAssistantStarToggle?: (assistant: Assistant) => void
  /**
   * Click handler for assistant delete
   */
  onAssistantDelete?: (assistant: Assistant) => void
  /**
   * Click handler for group settings
   */
  onGroupSettings?: (group: AssistantGroup) => void
  /**
   * Optional className for customization
   */
  className?: string
  /**
   * Use compact mode for list items
   */
  compact?: boolean
}

export function AssistantList({
  groups,
  selectedAssistantId,
  onAssistantClick,
  onAssistantSettings,
  onAssistantStarToggle,
  onAssistantDelete,
  onGroupSettings,
  className,
  compact = false,
}: AssistantListProps) {
  // Collect all starred assistants from all groups
  const starredAssistants = React.useMemo(() => {
    const assistants: Assistant[] = []
    groups.forEach((group) => {
      group.assistants.forEach((assistant) => {
        if (assistant.isStarred) {
          assistants.push(assistant)
        }
      })
    })
    return assistants
  }, [groups])

  const hasStarredAssistants = starredAssistants.length > 0

  // Create a virtual group for starred assistants
  const starredGroup: AssistantGroup = {
    id: 'starred',
    name: 'Starred',
    assistants: starredAssistants,
    defaultOpen: true,
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {/* Show starred assistants group first if there are any starred assistants */}
      {hasStarredAssistants && (
        <AssistantGroupComponent
          group={starredGroup}
          selectedAssistantId={selectedAssistantId}
          onAssistantClick={onAssistantClick}
          onAssistantSettings={onAssistantSettings}
          onAssistantStarToggle={onAssistantStarToggle}
          onAssistantDelete={onAssistantDelete}
          onGroupSettings={onGroupSettings}
          hideGroupMenu
          forceDefaultOpen
          compact={compact}
        />
      )}

      {/* Show all other assistant groups */}
      {groups.map((group, index) => (
        <AssistantGroupComponent
          key={group.id}
          group={group}
          selectedAssistantId={selectedAssistantId}
          onAssistantClick={onAssistantClick}
          onAssistantSettings={onAssistantSettings}
          onAssistantStarToggle={onAssistantStarToggle}
          onAssistantDelete={onAssistantDelete}
          onGroupSettings={onGroupSettings}
          forceDefaultOpen={!hasStarredAssistants && index === 0}
          ignoreGroupDefault={hasStarredAssistants}
          compact={compact}
        />
      ))}
    </div>
  )
}

interface AssistantGroupComponentProps {
  group: AssistantGroup
  selectedAssistantId?: string
  onAssistantClick?: (assistant: Assistant) => void
  onAssistantSettings?: (assistant: Assistant) => void
  onAssistantStarToggle?: (assistant: Assistant) => void
  onAssistantDelete?: (assistant: Assistant) => void
  onGroupSettings?: (group: AssistantGroup) => void
  hideGroupMenu?: boolean
  forceDefaultOpen?: boolean
  ignoreGroupDefault?: boolean
  compact?: boolean
}

function AssistantGroupComponent({
  group,
  selectedAssistantId,
  onAssistantClick,
  onAssistantSettings,
  onAssistantStarToggle,
  onAssistantDelete,
  onGroupSettings,
  hideGroupMenu = false,
  forceDefaultOpen = false,
  ignoreGroupDefault = false,
  compact = false,
}: AssistantGroupComponentProps) {
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
            className={cn(
              'w-full justify-start font-normal px-3',
              compact ? 'text-xs h-7' : 'text-sm h-9'
            )}
          >
            <ChevronDown
              className={cn(
                'transition-transform duration-200',
                compact ? 'size-3' : 'size-4',
                !isOpen && '-rotate-90'
              )}
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
        {group.assistants.map((assistant) => (
          <AssistantListItem
            key={assistant.id}
            logo={assistant.logo}
            avatarBg={assistant.avatarBg}
            avatarText={assistant.avatarText}
            name={assistant.name}
            persona={assistant.persona}
            modelName={assistant.modelName}
            capabilities={assistant.capabilities}
            isStarred={assistant.isStarred}
            isActive={selectedAssistantId === assistant.id}
            onClick={() => onAssistantClick?.(assistant)}
            onSettingsClick={() => onAssistantSettings?.(assistant)}
            onStarClick={() => onAssistantStarToggle?.(assistant)}
            onDeleteClick={onAssistantDelete ? () => onAssistantDelete(assistant) : undefined}
            compact={compact}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
