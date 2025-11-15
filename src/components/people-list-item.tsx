import * as React from "react"
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
} from "@/components/ui/item"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreVertical, Star } from "lucide-react"
import { cn } from "@/lib/utils"

interface PersonListItemProps {
  /**
   * URL or path to the person's avatar image
   */
  avatar?: string
  /**
   * Display name of the person
   */
  name: string
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

export function PersonListItem({
  avatar,
  name,
  email,
  phone: _phone,
  bio,
  isStarred = false,
  onClick,
  onSettingsClick,
  onStarClick,
  className,
  isActive = false,
}: PersonListItemProps) {
  const [isHovered, setIsHovered] = React.useState(false)

  // Get initials from name for fallback avatar
  const getInitials = (name: string) => {
    const parts = name.split(" ")
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    }
    return name.substring(0, 2).toUpperCase()
  }

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
      {/* Person avatar */}
      <Avatar className="size-8">
        {avatar ? (
          <AvatarImage src={avatar} alt={name} />
        ) : (
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
            {getInitials(name)}
          </AvatarFallback>
        )}
      </Avatar>

      {/* Person info */}
      <ItemContent>
        <ItemTitle className="text-sm font-medium">{name}</ItemTitle>
        {bio && (
          <ItemDescription>
            <span className="text-xs line-clamp-1">{bio}</span>
          </ItemDescription>
        )}
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
              Edit Contact
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                if (email) window.location.href = `mailto:${email}`
              }}
              disabled={!email}
            >
              Send Email
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Item>
  )
}

