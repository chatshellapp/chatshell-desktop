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
import { PersonListItem } from '@/components/people-list-item'

export interface Person {
  /**
   * Unique identifier for the person
   */
  id: string
  /**
   * Display name of the person
   */
  name: string
  /**
   * URL or path to the person's avatar image
   */
  avatar?: string
  /**
   * Person's email address
   */
  email?: string
  /**
   * Person's phone number
   */
  phone?: string
  /**
   * Person's bio or description
   */
  bio?: string
  /**
   * Whether the person is starred/favorited
   */
  isStarred?: boolean
}

export interface PersonGroup {
  /**
   * Unique identifier for the group
   */
  id: string
  /**
   * Group name (user-created)
   */
  name: string
  /**
   * List of people in this group
   */
  people: Person[]
  /**
   * Whether the group is initially open
   */
  defaultOpen?: boolean
}

interface PeopleListProps {
  /**
   * List of person groups
   */
  groups: PersonGroup[]
  /**
   * Currently selected person ID
   */
  selectedPersonId?: string
  /**
   * Click handler for person selection
   */
  onPersonClick?: (person: Person) => void
  /**
   * Click handler for person settings
   */
  onPersonSettings?: (person: Person) => void
  /**
   * Click handler for person star toggle
   */
  onPersonStarToggle?: (person: Person) => void
  /**
   * Click handler for group settings
   */
  onGroupSettings?: (group: PersonGroup) => void
  /**
   * Optional className for customization
   */
  className?: string
}

export function PeopleList({
  groups,
  selectedPersonId,
  onPersonClick,
  onPersonSettings,
  onPersonStarToggle,
  onGroupSettings,
  className,
}: PeopleListProps) {
  // Collect all starred people from all groups
  const starredPeople = React.useMemo(() => {
    const people: Person[] = []
    groups.forEach((group) => {
      group.people.forEach((person) => {
        if (person.isStarred) {
          people.push(person)
        }
      })
    })
    return people
  }, [groups])

  const hasStarredPeople = starredPeople.length > 0

  // Create a virtual group for starred people
  const starredGroup: PersonGroup = {
    id: 'starred',
    name: 'Starred',
    people: starredPeople,
    defaultOpen: true,
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {/* Show starred people group first if there are any starred people */}
      {hasStarredPeople && (
        <PersonGroupComponent
          group={starredGroup}
          selectedPersonId={selectedPersonId}
          onPersonClick={onPersonClick}
          onPersonSettings={onPersonSettings}
          onPersonStarToggle={onPersonStarToggle}
          onGroupSettings={onGroupSettings}
          hideGroupMenu
          forceDefaultOpen
        />
      )}

      {/* Show all other person groups */}
      {groups.map((group, index) => (
        <PersonGroupComponent
          key={group.id}
          group={group}
          selectedPersonId={selectedPersonId}
          onPersonClick={onPersonClick}
          onPersonSettings={onPersonSettings}
          onPersonStarToggle={onPersonStarToggle}
          onGroupSettings={onGroupSettings}
          forceDefaultOpen={!hasStarredPeople && index === 0}
          ignoreGroupDefault={hasStarredPeople}
        />
      ))}
    </div>
  )
}

interface PersonGroupComponentProps {
  group: PersonGroup
  selectedPersonId?: string
  onPersonClick?: (person: Person) => void
  onPersonSettings?: (person: Person) => void
  onPersonStarToggle?: (person: Person) => void
  onGroupSettings?: (group: PersonGroup) => void
  hideGroupMenu?: boolean
  forceDefaultOpen?: boolean
  ignoreGroupDefault?: boolean
}

function PersonGroupComponent({
  group,
  selectedPersonId,
  onPersonClick,
  onPersonSettings,
  onPersonStarToggle,
  onGroupSettings,
  hideGroupMenu = false,
  forceDefaultOpen = false,
  ignoreGroupDefault = false,
}: PersonGroupComponentProps) {
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
        {group.people.map((person) => (
          <PersonListItem
            key={person.id}
            avatar={person.avatar}
            name={person.name}
            email={person.email}
            phone={person.phone}
            bio={person.bio}
            isStarred={person.isStarred}
            isActive={selectedPersonId === person.id}
            onClick={() => onPersonClick?.(person)}
            onSettingsClick={() => onPersonSettings?.(person)}
            onStarClick={() => onPersonStarToggle?.(person)}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
