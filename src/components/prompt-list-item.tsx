import * as React from "react"
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
} from "@/components/ui/item"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreVertical, Star } from "lucide-react"
import { cn } from "@/lib/utils"

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
  className,
  isActive = false,
}: PromptListItemProps) {
  const [isHovered, setIsHovered] = React.useState(false)

  return (
    <Item
      className={cn(
        "cursor-pointer hover:bg-accent/50 transition-colors relative pr-0",
        isActive && "bg-accent",
        className
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      tabIndex={0}
      role="button"
      size="sm"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick?.()
        }
      }}
    >
      {/* Prompt info */}
      <ItemContent>
        <ItemTitle className="text-sm font-medium">{name}</ItemTitle>
        <ItemDescription>
          <span className="text-xs line-clamp-1">{content}</span>
        </ItemDescription>
      </ItemContent>

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        {/* Star button - always visible if starred, otherwise show on hover */}
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            "size-7 transition-opacity",
            isStarred && "text-yellow-500 hover:text-yellow-600",
            !isHovered && !isStarred && "opacity-0"
          )}
          onClick={(e) => {
            e.stopPropagation()
            onStarClick?.(e)
          }}
        >
          <Star
            className={cn("size-4", isStarred && "fill-current")}
          />
        </Button>

        {/* Menu button - only visible on hover */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "size-7 transition-opacity",
                !isHovered && "opacity-0"
              )}
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
                // Copy to clipboard logic could go here
              }}
            >
              Copy Content
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Item>
  )
}

