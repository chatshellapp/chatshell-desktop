import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { AvatarData } from './types'

interface MessageAvatarProps {
  avatar: string | AvatarData
  index: number
  fallbackChar: string
}

export function MessageAvatar({ avatar, index, fallbackChar }: MessageAvatarProps) {
  const offsetClass = index > 0 && 'ml-[-6px]'

  // If it's a string, treat it as an image URL (backward compatibility)
  if (typeof avatar === 'string') {
    return (
      <Avatar className={cn('size-4 ring-1 ring-background', offsetClass)}>
        <AvatarImage src={avatar} alt={`Avatar ${index + 1}`} />
        <AvatarFallback className="text-[10px]">{fallbackChar}</AvatarFallback>
      </Avatar>
    )
  }

  // Text avatar handling
  if (avatar.type === 'text') {
    const displayText = avatar.text || avatar.fallback || '?'
    const isPlaceholder = avatar.isPlaceholder === true
    const hasCustomBg = !!avatar.backgroundColor

    // For placeholder avatars, use Tailwind's bg-muted class
    if (isPlaceholder) {
      return (
        <Avatar className={cn('size-4 ring-1 ring-background bg-muted', offsetClass)}>
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
          className={cn('size-4 ring-1 ring-background', offsetClass)}
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
    return (
      <Avatar className={cn('size-4 ring-1 ring-background', offsetClass)}>
        <AvatarFallback className="text-[10px]">{displayText}</AvatarFallback>
      </Avatar>
    )
  }

  // Image avatar
  return (
    <Avatar className={cn('size-4 ring-1 ring-background', offsetClass)}>
      <AvatarImage src={avatar.imageUrl} alt={`Avatar ${index + 1}`} />
      <AvatarFallback className="text-[10px]">
        {avatar.fallback || fallbackChar}
      </AvatarFallback>
    </Avatar>
  )
}

interface AvatarGroupProps {
  avatars: (string | AvatarData)[]
  summary: string
  maxVisible?: number
}

export function MessageAvatarGroup({ avatars, summary, maxVisible = 3 }: AvatarGroupProps) {
  return (
    <div className="flex -space-x-1.5">
      {avatars.slice(0, maxVisible).map((avatar, index) => (
        <MessageAvatar
          key={index}
          avatar={avatar}
          index={index}
          fallbackChar={summary.charAt(index)}
        />
      ))}
      {avatars.length > maxVisible && (
        <Avatar className="size-4 ring-1 ring-background ml-[-6px]">
          <AvatarFallback className="text-[10px]">
            +{avatars.length - maxVisible}
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  )
}

