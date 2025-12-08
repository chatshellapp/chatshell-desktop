import { useMemo } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InputGroupButton } from '@/components/ui/input-group'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useConversationStore } from '@/stores/conversation'
import { useModelStore } from '@/stores/modelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { ModelList, type ModelVendor, type Model as ModelListModel } from '@/components/model-list'
import {
  AssistantList,
  type AssistantGroup,
  type Assistant as AssistantListAssistant,
} from '@/components/assistant-list'
import { AssistantHoverCard } from '@/components/assistant-hover-card'
import { getModelLogo } from '@/lib/model-logos'

interface ModelSelectorDropdownProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  activeTab: 'models' | 'assistants'
  onActiveTabChange: (tab: 'models' | 'assistants') => void
}

export function ModelSelectorDropdown({
  isOpen,
  onOpenChange,
  activeTab,
  onActiveTabChange,
}: ModelSelectorDropdownProps) {
  // Store hooks
  const selectedModel = useConversationStore((state) => state.selectedModel)
  const selectedAssistant = useConversationStore((state) => state.selectedAssistant)
  const setSelectedModel = useConversationStore((state) => state.setSelectedModel)
  const setSelectedAssistant = useConversationStore((state) => state.setSelectedAssistant)

  const models = useModelStore((state) => state.models)
  const getModelById = useModelStore((state) => state.getModelById)
  const getProviderById = useModelStore((state) => state.getProviderById)
  const updateModel = useModelStore((state) => state.updateModel)

  const assistants = useAssistantStore((state) => state.assistants)
  const updateAssistant = useAssistantStore((state) => state.updateAssistant)

  // Get display text for current selection
  const getSelectionDisplay = () => {
    if (selectedAssistant) {
      return selectedAssistant.role
        ? `${selectedAssistant.name} - ${selectedAssistant.role}`
        : selectedAssistant.name
    } else if (selectedModel) {
      const provider = getProviderById(selectedModel.provider_id)
      return provider ? `${selectedModel.name} - ${provider.name}` : selectedModel.name
    } else {
      return 'Select model or assistant'
    }
  }

  const handleModelSelect = (modelId: string) => {
    console.log('handleModelSelect called with modelId:', modelId)
    const model = getModelById(modelId)
    if (!model) {
      console.error('Model not found:', modelId)
      return
    }

    setSelectedModel(model)
    console.log('Selected model:', model.name)
    onOpenChange(false)
  }

  const handleAssistantSelect = (assistantId: string) => {
    console.log('handleAssistantSelect called with assistantId:', assistantId)
    const assistant = assistants.find((a) => a.id === assistantId)
    if (!assistant) {
      console.error('Assistant not found:', assistantId)
      return
    }

    setSelectedAssistant(assistant)
    console.log('Selected assistant:', assistant.name)
    onOpenChange(false)
  }

  const handleModelStarToggle = async (model: ModelListModel) => {
    console.log('Toggle star for model:', model)
    const realModel = models.find((m) => m.id === model.id)
    if (realModel) {
      try {
        await updateModel(realModel.id, {
          name: realModel.name,
          provider_id: realModel.provider_id,
          model_id: realModel.model_id,
          description: realModel.description,
          is_starred: !realModel.is_starred,
        })
      } catch (error) {
        console.error('Failed to toggle star:', error)
      }
    }
  }

  const handleAssistantStarToggle = async (assistant: AssistantListAssistant) => {
    console.log('Toggle star for assistant:', assistant)
    const realAssistant = assistants.find((a) => a.id === assistant.id)
    if (realAssistant) {
      try {
        await updateAssistant(realAssistant.id, {
          name: realAssistant.name,
          system_prompt: realAssistant.system_prompt,
          model_id: realAssistant.model_id,
          avatar_bg: realAssistant.avatar_bg,
          avatar_text: realAssistant.avatar_text,
          is_starred: !realAssistant.is_starred,
        })
      } catch (error) {
        console.error('Failed to toggle star:', error)
      }
    }
  }

  // Transform models to ModelVendor groups
  const modelVendors = useMemo((): ModelVendor[] => {
    const vendorMap = new Map<string, ModelListModel[]>()

    // Filter out soft-deleted models for selection UI
    const activeModels = models.filter((m) => !m.is_deleted)

    activeModels.forEach((model) => {
      const provider = getProviderById(model.provider_id)
      if (!provider) return

      const vendorKey = provider.id
      if (!vendorMap.has(vendorKey)) {
        vendorMap.set(vendorKey, [])
      }

      vendorMap.get(vendorKey)!.push({
        id: model.id,
        name: model.name,
        modelId: model.model_id,
        providerName: provider.name,
        isStarred: model.is_starred,
      })
    })

    return Array.from(vendorMap.entries()).map(([vendorId, models]) => {
      const provider = getProviderById(vendorId)
      return {
        id: vendorId,
        name: provider?.name || 'Unknown',
        models,
      }
    })
  }, [models, getProviderById])

  // Transform assistants to AssistantGroup groups
  const assistantGroups = useMemo((): AssistantGroup[] => {
    const groupMap = new Map<string, AssistantListAssistant[]>()

    assistants.forEach((assistant) => {
      const groupName = assistant.group_name || 'Default'
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, [])
      }

      // Get model info for the assistant
      const model = getModelById(assistant.model_id)

      groupMap.get(groupName)!.push({
        id: assistant.id,
        name: assistant.name,
        persona: assistant.role,
        description: assistant.description,
        modelName: model?.name,
        modelId: model?.model_id,
        logo: assistant.avatar_image_url,
        avatarBg: assistant.avatar_bg,
        avatarText: assistant.avatar_text,
        isStarred: assistant.is_starred,
      })
    })

    return Array.from(groupMap.entries()).map(([groupName, assistants]) => ({
      id: groupName.toLowerCase().replace(/\s+/g, '-'),
      name: groupName,
      assistants,
    }))
  }, [assistants, getModelById])

  // Get model info for the selected assistant
  const selectedAssistantModel = selectedAssistant
    ? getModelById(selectedAssistant.model_id)
    : null

  // Render the trigger button content
  const renderTriggerContent = () => {
    if (selectedAssistant) {
      // For assistants, show their avatar (custom image or text/emoji with background)
      const hasCustomImage =
        selectedAssistant.avatar_type === 'image' &&
        (selectedAssistant.avatar_image_url || selectedAssistant.avatar_image_path)
      const avatarBg = selectedAssistant.avatar_bg || '#3b82f6'
      const isHexColor = avatarBg.startsWith('#')
      const avatarStyle = isHexColor ? { backgroundColor: avatarBg } : undefined
      const avatarClassName = !isHexColor ? avatarBg : undefined

      return (
        <>
          <Avatar
            key={`assistant-${selectedAssistant.id}`}
            className={cn('h-4 w-4', avatarClassName)}
            style={avatarStyle}
          >
            {hasCustomImage && (
              <AvatarImage
                src={selectedAssistant.avatar_image_url || selectedAssistant.avatar_image_path}
                alt={selectedAssistant.name}
              />
            )}
            <AvatarFallback
              className={cn('text-white text-[8px]', avatarClassName)}
              style={avatarStyle}
            >
              {selectedAssistant.avatar_text || selectedAssistant.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs">{getSelectionDisplay()}</span>
        </>
      )
    } else if (selectedModel) {
      // For models, show model logo with first character fallback
      const modelLogo = getModelLogo(selectedModel)

      return (
        <>
          <Avatar key={`model-${selectedModel.id}`} className="size-4">
            {modelLogo && <AvatarImage src={modelLogo} alt={selectedModel.name} />}
            <AvatarFallback className="text-[10px]">
              {selectedModel.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs">{getSelectionDisplay()}</span>
        </>
      )
    } else {
      return <span className="text-xs">{getSelectionDisplay()}</span>
    }
  }

  // Build the trigger button, optionally wrapped with hover card for assistants
  const triggerButton = (
    <InputGroupButton variant="ghost" className="gap-2">
      {renderTriggerContent()}
    </InputGroupButton>
  )

  return (
    <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
      {selectedAssistant && !isOpen ? (
        <AssistantHoverCard
          name={selectedAssistant.name}
          role={selectedAssistant.role}
          description={selectedAssistant.description}
          modelName={selectedAssistantModel?.name}
          modelId={selectedAssistantModel?.model_id}
          logo={
            selectedAssistant.avatar_type === 'image'
              ? selectedAssistant.avatar_image_url || selectedAssistant.avatar_image_path
              : undefined
          }
          avatarBg={selectedAssistant.avatar_bg}
          avatarText={selectedAssistant.avatar_text}
          side="top"
          align="start"
        >
          <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
        </AssistantHoverCard>
      ) : (
        <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent
        side="top"
        align="start"
        className="[--radius:0.95rem] p-2 w-[320px] max-h-[400px] overflow-y-auto"
      >
        <Tabs
          value={activeTab}
          onValueChange={(value) => onActiveTabChange(value as 'models' | 'assistants')}
        >
          <TabsList className="grid w-full grid-cols-2 mb-2">
            <TabsTrigger value="models" className="text-xs">
              Models
            </TabsTrigger>
            <TabsTrigger value="assistants" className="text-xs">
              Assistants
            </TabsTrigger>
          </TabsList>
          <TabsContent value="models" className="mt-0">
            {modelVendors.length > 0 ? (
              <ModelList
                vendors={modelVendors}
                selectedModelId={selectedModel?.id}
                onModelClick={(model) => handleModelSelect(model.id)}
                onModelStarToggle={handleModelStarToggle}
                compact={true}
              />
            ) : (
              <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                No models available
              </div>
            )}
          </TabsContent>
          <TabsContent value="assistants" className="mt-0">
            {assistantGroups.length > 0 ? (
              <AssistantList
                groups={assistantGroups}
                selectedAssistantId={selectedAssistant?.id}
                onAssistantClick={(assistant) => handleAssistantSelect(assistant.id)}
                onAssistantStarToggle={handleAssistantStarToggle}
                compact={true}
              />
            ) : (
              <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                No assistants available
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

