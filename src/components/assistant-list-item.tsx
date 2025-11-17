import * as React from "react"
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemHeader,
} from "@/components/ui/item"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreVertical, Star, Sparkles, FileText, Database, Boxes, Bot } from "lucide-react"
import { cn } from "@/lib/utils"

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
   * Optional className for customization
   */
  className?: string
  /**
   * Whether the item is selected/active
   */
  isActive?: boolean
}

export function AssistantListItem({
  logo,
  avatarBg = "#3b82f6",
  avatarText,
  name,
  persona,
  capabilities = {},
  isStarred = false,
  onClick,
  onSettingsClick,
  onStarClick,
  className,
  isActive = false,
}: AssistantListItemProps) {
  const [isHovered, setIsHovered] = React.useState(false)

  // Count active capabilities to determine if we should show them
  const hasCapabilities = Object.values(capabilities).some(Boolean)

  // Determine if avatarBg is a hex color or a Tailwind class
  const isHexColor = avatarBg.startsWith("#")
  const avatarStyle = isHexColor ? { backgroundColor: avatarBg } : undefined
  const avatarClassName = !isHexColor ? avatarBg : undefined

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
      {/* Assistant logo */}
      <Avatar className={cn("size-8", avatarClassName)} style={avatarStyle}>
        {logo ? (
          <AvatarImage src={logo} alt={name} />
        ) : (
          <AvatarFallback className={cn("text-white", avatarClassName)} style={avatarStyle}>
            {avatarText || <Sparkles className="size-4" />}
          </AvatarFallback>
        )}
      </Avatar>

      {/* Assistant info */}
      <ItemContent>
        {/* First row: Name and Action buttons */}
        <ItemHeader>
          <ItemTitle className="text-sm font-medium leading-tight">{name}</ItemTitle>
          
          {/* Action buttons */}
          <div className="flex items-center gap-1">
            {/* Star button - show on hover */}
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "size-7 transition-opacity",
                isStarred && "text-yellow-500 hover:text-yellow-600",
                !isHovered && "opacity-0"
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
                  Configuration
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ItemHeader>
        
        {/* Second row: Persona */}
        {persona && (
          <div className="text-xs text-muted-foreground line-clamp-1 leading-tight">
            {persona}
          </div>
        )}
        
        {/* Third row: Capabilities */}
        {hasCapabilities && (
          <div className="flex items-center gap-1.5">
            {capabilities.hasModel && (
              <Avatar className="size-3 rounded-sm">
                {capabilities.modelLogo ? (
                  <AvatarImage src={capabilities.modelLogo} alt="Model" />
                ) : (
                  <AvatarFallback className="rounded-sm">
                    <Bot className="size-2" />
                  </AvatarFallback>
                )}
              </Avatar>
            )}
            {capabilities.hasFiles && (
              <FileText className="size-3 text-muted-foreground" />
            )}
            {capabilities.hasKnowledgeBase && (
              <Database className="size-3 text-muted-foreground" />
            )}
            {capabilities.hasTools && (
              <Boxes className="size-3 text-muted-foreground" />
            )}
          </div>
        )}
      </ItemContent>
    </Item>
  )
}

