import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getModelLogoById } from "@/lib/model-logos"
import { cn } from "@/lib/utils"

interface ModelAvatarProps {
  /**
   * Explicitly provided logo URL (highest priority)
   */
  logo?: string
  /**
   * Model ID for logo lookup (e.g., "qwen3:70b")
   */
  modelId?: string
  /**
   * Model name for logo lookup and fallback character (e.g., "Qwen3")
   * Note: Do NOT pass formatted names with provider (e.g., "Qwen3 - Ollama")
   */
  name?: string
  /**
   * Size variant
   */
  size?: "xxs" | "xs" | "sm" | "md"
  /**
   * Additional className for Avatar container
   */
  className?: string
}

const sizeConfig = {
  xxs: { avatar: "size-3", fallback: "text-[8px]" },
  xs: { avatar: "size-4", fallback: "text-[10px]" },
  sm: { avatar: "size-6", fallback: "text-[10px]" },
  md: { avatar: "size-8", fallback: "text-xs" },
}

export function ModelAvatar({
  logo,
  modelId,
  name,
  size = "md",
  className,
}: ModelAvatarProps) {
  // Get logo with fallback logic - same as model-list-item.tsx
  const displayLogo = logo || 
    (modelId ? getModelLogoById(modelId) : undefined) || 
    (name ? getModelLogoById(name) : undefined)

  const fallbackChar = name?.charAt(0)?.toUpperCase() || "M"
  const { avatar: avatarClass, fallback: fallbackClass } = sizeConfig[size]

  return (
    <Avatar className={cn(avatarClass, className)}>
      {displayLogo && <AvatarImage src={displayLogo} alt={name || "Model"} />}
      <AvatarFallback className={fallbackClass}>
        {fallbackChar}
      </AvatarFallback>
    </Avatar>
  )
}

