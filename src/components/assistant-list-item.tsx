import * as React from 'react'
import { Item, ItemContent, ItemTitle, ItemHeader } from '@/components/ui/item'
import { AssistantAvatar } from '@/components/assistant-avatar'
import { ModelAvatar } from '@/components/model-avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { MoreVertical, Star, FileText, Database, Boxes } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DeleteAssistantDialog } from './assistant-list-item/delete-dialog'

export interface AssistantCapabilities {
  /**
   * Model logo URL or path (displayed first if hasModel is true)
   */
  modelLogo?: string
  /**
   * Whether the assistant has a model configured
   */
  hasModel?: boolean
  /**
   * Whether the assistant can use files
   */
  hasFiles?: boolean
  /**
   * Whether the assistant can use knowledge base
   */
  hasKnowledgeBase?: boolean
  /**
   * Whether the assistant can use Tools
   */
  hasTools?: boolean
}

interface AssistantListItemProps {
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
   * Display name of the assistant (nickname)
   */
  name: string
  /**
   * Persona/role description of the assistant
   */
  persona?: string
  /**
   * Model name to display alongside assistant name
   */
  modelName?: string
  /**
   * Assistant capabilities
   */
  capabilities?: AssistantCapabilities
  /**
   * Whether the assistant is starred
   */
  isStarred?: boolean
  /**
   * Click handler for the item
   */
  onClick?: () => void
  /**
   * Click handler for settings button
   */
  onSettingsClick?: (e: React.MouseEvent) => void
  /**
   * Click handler for star button
   */
  onStarClick?: (e: React.MouseEvent) => void
  /**
   * Click handler for delete button
   */
  onDeleteClick?: (e: React.MouseEvent) => void
  /**
   * Optional className for customization
   */
  className?: string
  /**
   * Whether the item is selected/active
   */
  isActive?: boolean
  /**
   * Use compact mode (smaller avatar, inline model name, only star button)
   */
  compact?: boolean
}

export function AssistantListItem({
  logo,
  avatarBg = '#3b82f6',
  avatarText,
  name,
  persona,
  modelName,
  capabilities = {},
  isStarred = false,
  onClick,
  onSettingsClick,
  onStarClick,
  onDeleteClick,
  className,
  isActive = false,
  compact = false,
}: AssistantListItemProps) {
  const [isHovered, setIsHovered] = React.useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)

  // Count active capabilities to determine if we should show them
  const hasCapabilities = Object.values(capabilities).some(Boolean)

  if (compact) {
    return (
      <Item
        className={cn(
          'cursor-pointer hover:bg-accent/50 transition-colors',
          isActive && 'bg-accent',
          className
        )}
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        tabIndex={0}
        role="button"
        size="sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick?.()
          }
        }}
      >
        {/* Assistant logo - smaller in compact mode */}
        <AssistantAvatar
          logo={logo}
          avatarBg={avatarBg}
          avatarText={avatarText}
          name={name}
          size="xs"
        />

        {/* Assistant info */}
        <ItemContent>
          <ItemHeader className="relative">
            {/* Assistant name and model name on same line */}
            <ItemTitle className="text-xs font-medium leading-tight">
              {name}
              {modelName && ` - ${modelName}`}
            </ItemTitle>

            {/* Floating action overlay */}
            <div
              className={cn(
                'absolute right-0 top-1/2 -translate-y-1/2 flex items-center transition-opacity bg-accent rounded-md',
                !isHovered && 'opacity-0 pointer-events-none'
              )}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  'size-6',
                  isStarred && 'text-yellow-500 hover:text-yellow-600'
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  onStarClick?.(e)
                }}
              >
                <Star className={cn('size-3.5', isStarred && 'fill-current')} />
              </Button>
            </div>
          </ItemHeader>
        </ItemContent>
      </Item>
    )
  }

  return (
    <Item
      className={cn(
        'cursor-pointer hover:bg-accent/50 transition-colors',
        isActive && 'bg-accent',
        className
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      tabIndex={0}
      role="button"
      size="sm"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
    >
      {/* Assistant logo */}
      <AssistantAvatar
        logo={logo}
        avatarBg={avatarBg}
        avatarText={avatarText}
        name={name}
        size="md"
      />

      {/* Assistant info */}
      <ItemContent>
        {/* First row: Name */}
        <ItemHeader className="relative">
          <ItemTitle className="text-sm font-medium leading-tight">{name}</ItemTitle>

          {/* Floating action overlay */}
          <div
            className={cn(
              'absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1 transition-opacity bg-accent rounded-md',
              !isHovered && 'opacity-0 pointer-events-none'
            )}
          >
            {/* Star button */}
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                'size-7',
                isStarred && 'text-yellow-500 hover:text-yellow-600'
              )}
              onClick={(e) => {
                e.stopPropagation()
                onStarClick?.(e)
              }}
            >
              <Star className={cn('size-4', isStarred && 'fill-current')} />
            </Button>

            {/* Menu button */}
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
                    onSettingsClick?.(e)
                  }}
                >
                  Configuration
                </DropdownMenuItem>
                {onDeleteClick && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowDeleteDialog(true)
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ItemHeader>

        {/* Second row: Persona */}
        {persona && (
          <div className="text-xs text-muted-foreground line-clamp-1 leading-tight">{persona}</div>
        )}

        {/* Third row: Capabilities */}
        {hasCapabilities && (
          <div className="flex items-center gap-1.5">
            {capabilities.hasModel && (
              <ModelAvatar
                logo={capabilities.modelLogo}
                name={modelName}
                size="xxs"
                className="rounded-sm"
              />
            )}
            {capabilities.hasFiles && <FileText className="size-3 text-muted-foreground" />}
            {capabilities.hasKnowledgeBase && <Database className="size-3 text-muted-foreground" />}
            {capabilities.hasTools && <Boxes className="size-3 text-muted-foreground" />}
          </div>
        )}
      </ItemContent>

      {/* Delete confirmation dialog */}
      {onDeleteClick && (
        <DeleteAssistantDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onConfirm={(e?: React.MouseEvent) => {
            if (e) {
              onDeleteClick(e)
            } else {
              // Create a synthetic event for the callback
              onDeleteClick({} as React.MouseEvent)
            }
          }}
          assistantName={name}
        />
      )}
    </Item>
  )
}
