import * as React from 'react'
import { Item, ItemContent, ItemTitle, ItemDescription, ItemHeader } from '@/components/ui/item'
import { ModelAvatar } from '@/components/model-avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreVertical, Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModelListItemProps {
  /**
   * URL or path to the model logo
   */
  logo?: string
  /**
   * Display name of the model
   */
  name: string
  /**
   * Model ID or identifier
   */
  modelId: string
  /**
   * Provider name to display alongside model name
   */
  providerName?: string
  /**
   * Whether the model is starred
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
   * Optional className for customization
   */
  className?: string
  /**
   * Whether the item is selected/active
   */
  isActive?: boolean
  /**
   * Use compact mode (smaller avatar, inline provider name, only star button)
   */
  compact?: boolean
}

export function ModelListItem({
  logo,
  name,
  modelId,
  providerName,
  isStarred = false,
  onClick,
  onSettingsClick,
  onStarClick,
  className,
  isActive = false,
  compact = false,
}: ModelListItemProps) {
  const [isHovered, setIsHovered] = React.useState(false)

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
        {/* Model logo - smaller in compact mode */}
        <ModelAvatar logo={logo} modelId={modelId} name={name} size="xs" />

        {/* Model info */}
        <ItemContent>
          <ItemHeader className="relative">
            {/* Model name and provider name on same line */}
            <ItemTitle className="text-xs font-medium leading-tight">
              {name}
              {providerName && ` - ${providerName}`}
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
      {/* Model logo */}
      <ModelAvatar logo={logo} modelId={modelId} name={name} size="md" />

      {/* Model info */}
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
                  Configuration
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ItemHeader>

        {/* Second row: Model ID */}
        <ItemDescription className="text-xs text-muted-foreground line-clamp-1">
          {modelId}
        </ItemDescription>
      </ItemContent>
    </Item>
  )
}
