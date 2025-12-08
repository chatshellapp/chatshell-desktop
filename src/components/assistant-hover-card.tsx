import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { AssistantAvatar } from '@/components/assistant-avatar'
import { ModelAvatar } from '@/components/model-avatar'
import { getModelLogoById } from '@/lib/model-logos'

interface AssistantHoverCardProps {
  children: React.ReactNode
  /**
   * Assistant name
   */
  name: string
  /**
   * Role/persona of the assistant
   */
  role?: string
  /**
   * Description of the assistant
   */
  description?: string
  /**
   * Model name to display
   */
  modelName?: string
  /**
   * Model ID for logo lookup
   */
  modelId?: string
  /**
   * URL or path to the assistant logo image
   */
  logo?: string
  /**
   * Background color for the avatar (e.g., "#3b82f6", "bg-blue-500")
   */
  avatarBg?: string
  /**
   * Text or emoji to display in the avatar
   */
  avatarText?: string
  /**
   * Side where the hover card should appear
   */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /**
   * Alignment of the hover card
   */
  align?: 'start' | 'center' | 'end'
  /**
   * Whether to disable the hover card (just render children)
   */
  disabled?: boolean
}

export function AssistantHoverCard({
  children,
  name,
  role,
  description,
  modelName,
  modelId,
  logo,
  avatarBg,
  avatarText,
  side = 'top',
  align = 'center',
  disabled = false,
}: AssistantHoverCardProps) {
  // Get model logo from modelId
  const modelLogo = modelId ? getModelLogoById(modelId) : undefined

  // If disabled, just render children without hover card
  if (disabled) {
    return <>{children}</>
  }

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} align={align} className="w-72 p-3">
        <div className="flex gap-3">
          {/* Left: Avatar */}
          <div className="shrink-0">
            <AssistantAvatar
              logo={logo}
              avatarBg={avatarBg}
              avatarText={avatarText}
              name={name}
              size="md"
            />
          </div>

          {/* Right: Info */}
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            {/* Line 1: Name */}
            <div className="font-medium text-sm truncate">{name}</div>

            {/* Line 2: Role */}
            {role && (
              <div className="text-xs text-muted-foreground truncate">{role}</div>
            )}

            {/* Line 3: Description (max 2 lines) */}
            {description && (
              <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {description}
              </div>
            )}

            {/* Line 4: Model icon + Model name */}
            {(modelName || modelId) && (
              <div className="flex items-center gap-1.5 mt-1">
                <ModelAvatar
                  logo={modelLogo}
                  modelId={modelId}
                  name={modelName}
                  size="xxs"
                />
                <span className="text-xs text-muted-foreground truncate">
                  {modelName || modelId}
                </span>
              </div>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

