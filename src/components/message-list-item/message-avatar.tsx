import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { CSSProperties } from 'react'
import type { AvatarData } from './types'

// Avatars are 16px and overlap their left neighbour by 4px (-ml-1). Instead of
// a ring painted in a fixed background color (which mismatches the sidebar,
// hover and active rows), cut a transparent crescent where the neighbour sits:
// its center is 4px left of this avatar's left edge, plus a 2px gap.
const NEIGHBOR_CUTOUT_MASK = 'radial-gradient(circle at -4px 50%, transparent 10px, #000 10.5px)'
const NEIGHBOR_CUTOUT: CSSProperties = {
  maskImage: NEIGHBOR_CUTOUT_MASK,
  WebkitMaskImage: NEIGHBOR_CUTOUT_MASK,
}

function stackStyle(index: number, style?: CSSProperties): CSSProperties | undefined {
  if (index === 0) return style
  return { ...style, ...NEIGHBOR_CUTOUT }
}

interface MessageAvatarProps {
  avatar: string | AvatarData
  index: number
  fallbackChar: string
}

export function MessageAvatar({ avatar, index, fallbackChar }: MessageAvatarProps) {
  const offsetClass = index > 0 && '-ml-1'

  // If it's a string, treat it as an image URL (backward compatibility)
  if (typeof avatar === 'string') {
    return (
      <Avatar className={cn('size-4 bg-muted', offsetClass)} style={stackStyle(index)}>
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
        <Avatar className={cn('size-4 bg-muted', offsetClass)} style={stackStyle(index)}>
          <AvatarFallback className="text-[10px] bg-muted opacity-0">{displayText}</AvatarFallback>
        </Avatar>
      )
    }

    // For text/emoji avatars with custom background (e.g., assistants)
    if (hasCustomBg) {
      return (
        <Avatar
          className={cn('size-4', offsetClass)}
          style={stackStyle(index, { backgroundColor: avatar.backgroundColor })}
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
      <Avatar className={cn('size-4', offsetClass)} style={stackStyle(index)}>
        <AvatarFallback className="text-[10px]">{displayText}</AvatarFallback>
      </Avatar>
    )
  }

  // Image avatar
  return (
    <Avatar className={cn('size-4 bg-muted', offsetClass)} style={stackStyle(index)}>
      <AvatarImage src={avatar.imageUrl} alt={`Avatar ${index + 1}`} />
      <AvatarFallback className="text-[10px]">{avatar.fallback || fallbackChar}</AvatarFallback>
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
    <div className="flex items-center">
      {avatars.slice(0, maxVisible).map((avatar, index) => (
        <MessageAvatar
          key={index}
          avatar={avatar}
          index={index}
          fallbackChar={summary.charAt(index)}
        />
      ))}
      {avatars.length > maxVisible && (
        <Avatar className="size-4 -ml-1" style={NEIGHBOR_CUTOUT}>
          <AvatarFallback className="text-[10px]">+{avatars.length - maxVisible}</AvatarFallback>
        </Avatar>
      )}
    </div>
  )
}
