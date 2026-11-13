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
import { ChevronDown, Drama, MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AssistantListItem, AssistantCapabilities } from '@/components/assistant-list-item'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RenameDialog } from '@/components/message-list-item/rename-dialog'
import { UNGROUPED_GROUP_NAME } from '@/lib/assistant-utils'

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
   * Description of the assistant
   */
  description?: string
  /**
   * Model name to display
   */
  modelName?: string
  /**
   * Model ID for logo lookup
   */
  modelId?: string
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
   * Double-click or Enter on a assistant
   */
  onAssistantActivate?: (assistant: Assistant) => void
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
   * Rename a group, or ungroup its assistants when the new name is empty.
   * The group menu is hidden when absent.
   */
  onGroupRename?: (group: AssistantGroup, newName: string) => void
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
  onAssistantActivate,
  onAssistantSettings,
  onAssistantStarToggle,
  onAssistantDelete,
  onGroupRename,
  className,
  compact = false,
}: AssistantListProps) {
  const { t } = useTranslation('assistants')
  const { t: tSidebar } = useTranslation('sidebar')
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
    name: tSidebar('starred'),
    assistants: starredAssistants,
    defaultOpen: true,
  }

  // Check if there are any assistants at all
  const totalAssistants = groups.reduce((acc, group) => acc + group.assistants.length, 0)

  if (totalAssistants === 0) {
    return (
      <Empty className={className}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Drama />
          </EmptyMedia>
          <EmptyTitle>{t('noAssistants')}</EmptyTitle>
          <EmptyDescription>{t('createFirstAssistant')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {/* Show starred assistants group first if there are any starred assistants */}
      {hasStarredAssistants && (
        <AssistantGroupComponent
          group={starredGroup}
          selectedAssistantId={selectedAssistantId}
          onAssistantClick={onAssistantClick}
          onAssistantActivate={onAssistantActivate}
          onAssistantSettings={onAssistantSettings}
          onAssistantStarToggle={onAssistantStarToggle}
          onAssistantDelete={onAssistantDelete}
          onGroupRename={onGroupRename}
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
          onAssistantActivate={onAssistantActivate}
          onAssistantSettings={onAssistantSettings}
          onAssistantStarToggle={onAssistantStarToggle}
          onAssistantDelete={onAssistantDelete}
          onGroupRename={onGroupRename}
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
  onAssistantActivate?: (assistant: Assistant) => void
  onAssistantSettings?: (assistant: Assistant) => void
  onAssistantStarToggle?: (assistant: Assistant) => void
  onAssistantDelete?: (assistant: Assistant) => void
  onGroupRename?: (group: AssistantGroup, newName: string) => void
  hideGroupMenu?: boolean
  forceDefaultOpen?: boolean
  ignoreGroupDefault?: boolean
  compact?: boolean
}

function AssistantGroupComponent({
  group,
  selectedAssistantId,
  onAssistantClick,
  onAssistantActivate,
  onAssistantSettings,
  onAssistantStarToggle,
  onAssistantDelete,
  onGroupRename,
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
  const [showRenameDialog, setShowRenameDialog] = React.useState(false)
  const { t } = useTranslation('sidebar')
  const isUngrouped = group.name === UNGROUPED_GROUP_NAME
  // The virtual "Ungrouped" bucket has no name to edit
  const showGroupMenu = !hideGroupMenu && !isUngrouped && !!onGroupRename

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
            <span className="flex-1 text-left">{isUngrouped ? t('ungrouped') : group.name}</span>
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
                  {t('renameGroup')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onGroupRename?.(group, '')
                  }}
                >
                  {t('ungroupAssistants')}
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
            description={assistant.description}
            modelName={assistant.modelName}
            modelId={assistant.modelId}
            capabilities={assistant.capabilities}
            isStarred={assistant.isStarred}
            isActive={selectedAssistantId === assistant.id}
            onClick={() => onAssistantClick?.(assistant)}
            onActivate={onAssistantActivate ? () => onAssistantActivate(assistant) : undefined}
            onSettingsClick={() => onAssistantSettings?.(assistant)}
            onStarClick={() => onAssistantStarToggle?.(assistant)}
            onDeleteClick={onAssistantDelete ? () => onAssistantDelete(assistant) : undefined}
            compact={compact}
          />
        ))}
      </CollapsibleContent>

      {showGroupMenu && (
        <RenameDialog
          open={showRenameDialog}
          onOpenChange={setShowRenameDialog}
          currentTitle={group.name}
          onRename={(newName) => onGroupRename?.(group, newName)}
          title={t('renameGroup')}
          description={t('renameGroupDescription')}
          placeholder={t('groupNamePlaceholder')}
        />
      )}
    </Collapsible>
  )
}
