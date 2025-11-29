import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

interface AssistantAvatarProps {
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
   * Assistant name (for alt text)
   */
  name?: string
  /**
   * Size variant
   */
  size?: "xs" | "sm" | "md"
  /**
   * Additional className for Avatar container
   */
  className?: string
}

const sizeConfig = {
  xs: { avatar: "size-4", fallbackText: "text-[8px]", sparkles: "size-2" },
  sm: { avatar: "size-6", fallbackText: "text-[10px]", sparkles: "size-3" },
  md: { avatar: "size-8", fallbackText: "text-sm", sparkles: "size-4" },
}

export function AssistantAvatar({
  logo,
  avatarBg = "#3b82f6",
  avatarText,
  name,
  size = "md",
  className,
}: AssistantAvatarProps) {
  // Determine if avatarBg is a hex color or a Tailwind class
  const isHexColor = avatarBg.startsWith("#")
  const avatarStyle = isHexColor ? { backgroundColor: avatarBg } : undefined
  const avatarClassName = !isHexColor ? avatarBg : undefined

  const { avatar: avatarSizeClass, fallbackText: fallbackTextClass, sparkles: sparklesClass } = sizeConfig[size]

  return (
    <Avatar className={cn(avatarSizeClass, avatarClassName, className)} style={avatarStyle}>
      {logo ? (
        <AvatarImage src={logo} alt={name || "Assistant"} />
      ) : (
        <AvatarFallback 
          className={cn("text-white", fallbackTextClass, avatarClassName)} 
          style={avatarStyle}
        >
          {avatarText || <Sparkles className={sparklesClass} />}
        </AvatarFallback>
      )}
    </Avatar>
  )
}

