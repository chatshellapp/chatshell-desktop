import * as React from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, MoreVertical } from "lucide-react"
import { cn } from "@/lib/utils"
import { AssistantListItem, AssistantCapabilities } from "@/components/assistant-list-item"

export interface Assistant {
  /**
   * Unique identifier for the assistant
   */
  id: string
  /**
   * Display name of the assistant
   */
  name: string
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
   * Click handler for group settings
   */
  onGroupSettings?: (group: AssistantGroup) => void
  /**
   * Optional className for customization
   */
  className?: string
}

export function AssistantList({
  groups,
  selectedAssistantId,
  onAssistantClick,
  onAssistantSettings,
  onAssistantStarToggle,
  onGroupSettings,
  className,
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
    id: "starred",
    name: "Starred",
    assistants: starredAssistants,
    defaultOpen: true,
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {/* Show starred assistants group first if there are any starred assistants */}
      {hasStarredAssistants && (
        <AssistantGroupComponent
          group={starredGroup}
          selectedAssistantId={selectedAssistantId}
          onAssistantClick={onAssistantClick}
          onAssistantSettings={onAssistantSettings}
          onAssistantStarToggle={onAssistantStarToggle}
          onGroupSettings={onGroupSettings}
          hideGroupMenu
          forceDefaultOpen
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
          onGroupSettings={onGroupSettings}
          forceDefaultOpen={!hasStarredAssistants && index === 0}
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
  onGroupSettings?: (group: AssistantGroup) => void
  hideGroupMenu?: boolean
  forceDefaultOpen?: boolean
}

function AssistantGroupComponent({
  group,
  selectedAssistantId,
  onAssistantClick,
  onAssistantSettings,
  onAssistantStarToggle,
  onGroupSettings,
  hideGroupMenu = false,
  forceDefaultOpen = false,
}: AssistantGroupComponentProps) {
  // Determine initial open state: use forceDefaultOpen if provided, otherwise use group.defaultOpen, default to false
  const initialOpenState = forceDefaultOpen || (group.defaultOpen ?? false)
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
            className="w-full justify-start font-medium text-sm h-9 px-3"
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-200",
                !isOpen && "-rotate-90"
              )}
            />
            <span className="flex-1 text-left">{group.name}</span>
          </Button>
        </CollapsibleTrigger>

        {/* Group menu button */}
        {!hideGroupMenu && (
          <div
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2 transition-opacity",
              !isHovered && "opacity-0"
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
            capabilities={assistant.capabilities}
            isStarred={assistant.isStarred}
            isActive={selectedAssistantId === assistant.id}
            onClick={() => onAssistantClick?.(assistant)}
            onSettingsClick={() => onAssistantSettings?.(assistant)}
            onStarClick={() => onAssistantStarToggle?.(assistant)}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

