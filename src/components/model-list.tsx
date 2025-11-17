import * as React from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, MoreVertical } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModelListItem } from "@/components/model-list-item"

export interface Model {
  /**
   * Unique identifier for the model
   */
  id: string
  /**
   * Display name of the model
   */
  name: string
  /**
   * Model ID or identifier
   */
  modelId: string
  /**
   * Provider name to display
   */
  providerName?: string
  /**
   * URL or path to the model logo
   */
  logo?: string
  /**
   * Whether the model is starred
   */
  isStarred?: boolean
}

export interface ModelVendor {
  /**
   * Unique identifier for the vendor
   */
  id: string
  /**
   * Vendor name (e.g., OpenAI, OpenRouter, Ollama)
   */
  name: string
  /**
   * List of models from this vendor
   */
  models: Model[]
  /**
   * Whether the group is initially open
   */
  defaultOpen?: boolean
}

interface ModelListProps {
  /**
   * List of vendors and their models
   */
  vendors: ModelVendor[]
  /**
   * Currently selected model ID
   */
  selectedModelId?: string
  /**
   * Click handler for model selection
   */
  onModelClick?: (model: Model) => void
  /**
   * Click handler for model settings
   */
  onModelSettings?: (model: Model) => void
  /**
   * Click handler for model star toggle
   */
  onModelStarToggle?: (model: Model) => void
  /**
   * Click handler for vendor settings
   */
  onVendorSettings?: (vendor: ModelVendor) => void
  /**
   * Optional className for customization
   */
  className?: string
  /**
   * Use compact mode for list items
   */
  compact?: boolean
}

export function ModelList({
  vendors,
  selectedModelId,
  onModelClick,
  onModelSettings,
  onModelStarToggle,
  onVendorSettings,
  className,
  compact = false,
}: ModelListProps) {
  // Collect all starred models from all vendors
  const starredModels = React.useMemo(() => {
    const models: Model[] = []
    vendors.forEach((vendor) => {
      vendor.models.forEach((model) => {
        if (model.isStarred) {
          models.push(model)
        }
      })
    })
    return models
  }, [vendors])

  const hasStarredModels = starredModels.length > 0

  // Create a virtual vendor for starred models
  const starredVendor: ModelVendor = {
    id: "starred",
    name: "Starred",
    models: starredModels,
    defaultOpen: true,
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {/* Show starred models group first if there are any starred models */}
      {hasStarredModels && (
        <ModelVendorGroup
          vendor={starredVendor}
          selectedModelId={selectedModelId}
          onModelClick={onModelClick}
          onModelSettings={onModelSettings}
          onModelStarToggle={onModelStarToggle}
          onVendorSettings={onVendorSettings}
          hideVendorMenu
          forceDefaultOpen
          compact={compact}
        />
      )}

      {/* Show all other vendor groups */}
      {vendors.map((vendor, index) => (
        <ModelVendorGroup
          key={vendor.id}
          vendor={vendor}
          selectedModelId={selectedModelId}
          onModelClick={onModelClick}
          onModelSettings={onModelSettings}
          onModelStarToggle={onModelStarToggle}
          onVendorSettings={onVendorSettings}
          forceDefaultOpen={!hasStarredModels && index === 0}
          ignoreVendorDefault={hasStarredModels}
          compact={compact}
        />
      ))}
    </div>
  )
}

interface ModelVendorGroupProps {
  vendor: ModelVendor
  selectedModelId?: string
  onModelClick?: (model: Model) => void
  onModelSettings?: (model: Model) => void
  onModelStarToggle?: (model: Model) => void
  onVendorSettings?: (vendor: ModelVendor) => void
  hideVendorMenu?: boolean
  forceDefaultOpen?: boolean
  ignoreVendorDefault?: boolean
  compact?: boolean
}

function ModelVendorGroup({
  vendor,
  selectedModelId,
  onModelClick,
  onModelSettings,
  onModelStarToggle,
  onVendorSettings,
  hideVendorMenu = false,
  forceDefaultOpen = false,
  ignoreVendorDefault = false,
  compact = false,
}: ModelVendorGroupProps) {
  // Determine initial open state: 
  // - If forceDefaultOpen is true, always open
  // - If ignoreVendorDefault is true, ignore vendor.defaultOpen (use false)
  // - Otherwise use vendor.defaultOpen, default to false
  const initialOpenState = forceDefaultOpen || (!ignoreVendorDefault && (vendor.defaultOpen ?? false))
  const [isOpen, setIsOpen] = React.useState(initialOpenState)
  const [isHovered, setIsHovered] = React.useState(false)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className="group/vendor-header relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "w-full justify-start font-normal px-3",
              compact ? "text-xs h-7" : "text-sm h-9"
            )}
          >
            <ChevronDown
              className={cn(
                "transition-transform duration-200",
                compact ? "size-3" : "size-4",
                !isOpen && "-rotate-90"
              )}
            />
            <span className="flex-1 text-left">{vendor.name}</span>
          </Button>
        </CollapsibleTrigger>

        {/* Vendor menu button */}
        {!hideVendorMenu && (
          <div
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2 transition-opacity",
              !isHovered && "opacity-0"
            )}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
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
                    onVendorSettings?.(vendor)
                  }}
                >
                  Configuration
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <CollapsibleContent className="space-y-0.5 px-1 pb-1">
        {vendor.models.map((model) => (
          <ModelListItem
            key={model.id}
            logo={model.logo}
            name={model.name}
            modelId={model.modelId}
            providerName={model.providerName}
            isStarred={model.isStarred}
            isActive={selectedModelId === model.id}
            onClick={() => onModelClick?.(model)}
            onSettingsClick={() => onModelSettings?.(model)}
            onStarClick={() => onModelStarToggle?.(model)}
            compact={compact}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

