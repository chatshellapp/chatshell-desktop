import * as React from "react"
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
} from "@/components/ui/item"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

export interface AvatarData {
  type: 'text' | 'image'
  // For text avatars
  text?: string
  backgroundColor?: string
  // For image avatars
  imageUrl?: string
  // Common
  fallback?: string
  // Special flag for placeholder avatars
  isPlaceholder?: boolean
}

interface MessageListItemProps {
  /**
   * Array of avatar URLs or avatar data objects
   */
  avatars: (string | AvatarData)[]
  /**
   * Message summary or conversation title
   */
  summary: string
  /**
   * Timestamp of the last message
   */
  timestamp: string
  /**
   * Content of the last message
   */
  lastMessage: string
  /**
   * Optional click handler
   */
  onClick?: () => void
  /**
   * Optional className for customization
   */
  className?: string
  /**
   * Whether the item is selected/active
   */
  isActive?: boolean
}

export function MessageListItem({
  avatars,
  summary,
  timestamp,
  lastMessage,
  onClick,
  className,
  isActive = false,
}: MessageListItemProps) {
  const maxVisibleAvatars = 3

  // Helper function to render an avatar
  const renderAvatar = (avatar: string | AvatarData, index: number) => {
    // If it's a string, treat it as an image URL (backward compatibility)
    if (typeof avatar === 'string') {
      return (
        <Avatar
          key={index}
          className={cn(
            "size-4 ring-1 ring-background",
            index > 0 && "ml-[-6px]"
          )}
        >
          <AvatarImage src={avatar} alt={`Avatar ${index + 1}`} />
          <AvatarFallback className="text-[10px]">
            {summary.charAt(index)}
          </AvatarFallback>
        </Avatar>
      )
    }

    // If it's an AvatarData object
    if (avatar.type === 'text') {
      const displayText = avatar.text || avatar.fallback || '?'
      const isPlaceholder = avatar.isPlaceholder === true
      const hasCustomBg = !!avatar.backgroundColor
      
      // For placeholder avatars, use Tailwind's bg-muted class
      if (isPlaceholder) {
        return (
          <Avatar
            key={index}
            className={cn(
              "size-4 ring-1 ring-background bg-muted",
              index > 0 && "ml-[-6px]"
            )}
          >
            <AvatarFallback className="text-[10px] bg-muted opacity-0">
              {displayText}
            </AvatarFallback>
          </Avatar>
        )
      }
      
      // For text/emoji avatars with custom background (e.g., assistants)
      if (hasCustomBg) {
        return (
          <Avatar
            key={index}
            className={cn(
              "size-4 ring-1 ring-background",
              index > 0 && "ml-[-6px]"
            )}
            style={{ backgroundColor: avatar.backgroundColor }}
          >
            <AvatarFallback
              className="text-[10px] text-white"
              style={{ backgroundColor: avatar.backgroundColor }}
            >
              {displayText}
            </AvatarFallback>
          </Avatar>
        )
      }
      
      // For text avatars without custom background (e.g., models without logo)
      // Use default AvatarFallback styling (bg-muted)
      return (
        <Avatar
          key={index}
          className={cn(
            "size-4 ring-1 ring-background",
            index > 0 && "ml-[-6px]"
          )}
        >
          <AvatarFallback className="text-[10px]">
            {displayText}
          </AvatarFallback>
        </Avatar>
      )
    }

    // Image avatar
    return (
      <Avatar
        key={index}
        className={cn(
          "size-4 ring-1 ring-background",
          index > 0 && "ml-[-6px]"
        )}
      >
        <AvatarImage src={avatar.imageUrl} alt={`Avatar ${index + 1}`} />
        <AvatarFallback className="text-[10px]">
          {avatar.fallback || summary.charAt(index)}
        </AvatarFallback>
      </Avatar>
    )
  }

  return (
    <Item
      className={cn(
        "cursor-pointer hover:bg-accent/50 transition-colors",
        isActive && "bg-accent",
        className
      )}
      onClick={onClick}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick?.()
        }
      }}
    >
      {/* Content area - full width */}
      <ItemContent>
        {/* First line: Summary (can wrap) */}
        <ItemTitle className="line-clamp-2">{summary}</ItemTitle>

        {/* Second line: Last message content (truncated) */}
        <ItemDescription className="line-clamp-1 text-xs">
          {lastMessage}
        </ItemDescription>

        {/* Third line: Timestamp and small avatars */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {timestamp}
          </span>
          
          {/* Small avatars on the right */}
          <div className="flex -space-x-1.5">
            {avatars.slice(0, maxVisibleAvatars).map((avatar, index) => 
              renderAvatar(avatar, index)
            )}
            {avatars.length > maxVisibleAvatars && (
              <Avatar className="size-4 ring-1 ring-background ml-[-6px]">
                <AvatarFallback className="text-[10px]">
                  +{avatars.length - maxVisibleAvatars}
                </AvatarFallback>
              </Avatar>
            )}
          </div>
        </div>
      </ItemContent>
    </Item>
  )
}

// Export a container for a list of message items
export function MessageListItemGroup({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)} role="list">
      {children}
    </div>
  )
}

