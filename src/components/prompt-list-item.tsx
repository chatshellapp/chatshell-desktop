import * as React from 'react'
import { Item, ItemContent, ItemTitle, ItemDescription, ItemHeader } from '@/components/ui/item'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { MoreVertical, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DeletePromptDialog } from './prompt-list-item/delete-dialog'

interface PromptListItemProps {
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
   * Click handler for copy content
   */
  onCopyContent?: (content: string) => void
  /**
   * Optional className for customization
   */
  className?: string
  /**
   * Whether the item is selected/active
   */
  isActive?: boolean
}

export function PromptListItem({
  name,
  content,
  isStarred = false,
  onClick,
  onSettingsClick,
  onStarClick,
  onDeleteClick,
  onCopyContent,
  className,
  isActive = false,
}: PromptListItemProps) {
  const [isHovered, setIsHovered] = React.useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)

  const handleCopyContent = async () => {
    try {
      await navigator.clipboard.writeText(content)
      // You could add a toast notification here if you have a toast system
      console.log('Prompt content copied to clipboard')
      onCopyContent?.(content)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
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
      {/* Prompt info */}
      <ItemContent>
        {/* First row: Name */}
        <ItemHeader className="relative">
          <ItemTitle className="text-sm font-medium">{name}</ItemTitle>

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
                  Edit Prompt
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopyContent()
                  }}
                >
                  Copy Content
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

        {/* Second row: Content */}
        <ItemDescription>
          <span className="text-xs line-clamp-1">{content}</span>
        </ItemDescription>
      </ItemContent>

      {/* Delete confirmation dialog */}
      {onDeleteClick && (
        <DeletePromptDialog
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
          promptName={name}
        />
      )}
    </Item>
  )
}
