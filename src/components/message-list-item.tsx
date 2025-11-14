import * as React from "react"
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
} from "@/components/ui/item"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

interface MessageListItemProps {
  /**
   * Array of avatar URLs or single avatar URL
   */
  avatars: string | string[]
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
   * Optional fallback text for avatars
   */
  avatarFallbacks?: string[]
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
  avatarFallbacks,
  onClick,
  className,
  isActive = false,
}: MessageListItemProps) {
  // Normalize avatars to array
  const avatarList = Array.isArray(avatars) ? avatars : [avatars]
  const maxVisibleAvatars = 3

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
            {avatarList.slice(0, maxVisibleAvatars).map((avatar, index) => (
              <Avatar
                key={index}
                className={cn(
                  "size-4 ring-1 ring-background",
                  index > 0 && "ml-[-6px]"
                )}
              >
                <AvatarImage src={avatar} alt={`Avatar ${index + 1}`} />
                <AvatarFallback className="text-[10px]">
                  {avatarFallbacks?.[index] || summary.charAt(index)}
                </AvatarFallback>
              </Avatar>
            ))}
            {avatarList.length > maxVisibleAvatars && (
              <Avatar className="size-4 ring-1 ring-background ml-[-6px]">
                <AvatarFallback className="text-[10px]">
                  +{avatarList.length - maxVisibleAvatars}
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

