import { Bot, Drama, Users } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ModelList, type Model, type ModelVendor } from '@/components/model-list'
import { AssistantList, type Assistant, type AssistantGroup } from '@/components/assistant-list'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

interface ContactsContentProps {
  activeTab: string
  onTabChange: (tab: string) => void
  vendorsList: ModelVendor[]
  assistantGroups: AssistantGroup[]
  selectedModelId?: string
  selectedAssistantId?: string
  onModelClick: (model: Model) => void
  onModelSettings: (model: Model) => void
  onModelStarToggle: (model: Model) => void
  onVendorSettings: (vendor: ModelVendor) => void
  onAssistantClick: (assistant: Assistant) => void
  onAssistantSettings: (assistant: Assistant) => void
  onAssistantStarToggle: (assistant: Assistant) => void
  onAssistantDelete: (assistant: Assistant) => void
  onGroupSettings: (group: AssistantGroup) => void
}

export function ContactsContent({
  activeTab,
  onTabChange,
  vendorsList,
  assistantGroups,
  selectedModelId,
  selectedAssistantId,
  onModelClick,
  onModelSettings,
  onModelStarToggle,
  onVendorSettings,
  onAssistantClick,
  onAssistantSettings,
  onAssistantStarToggle,
  onAssistantDelete,
  onGroupSettings,
}: ContactsContentProps) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full p-2">
      <TabsList className="w-full grid grid-cols-3 h-9">
        <TabsTrigger value="models" className="text-xs gap-1 px-2">
          <Bot className="size-3.5" />
          Models
        </TabsTrigger>
        <TabsTrigger value="assistants" className="text-xs gap-1 px-2">
          <Drama className="size-3.5" />
          Assistants
        </TabsTrigger>
        <TabsTrigger value="people" className="text-xs gap-1 px-2">
          <Users className="size-3.5" />
          People
        </TabsTrigger>
      </TabsList>
      <TabsContent value="models" className="mt-2">
        <ModelList
          vendors={vendorsList}
          selectedModelId={selectedModelId}
          onModelClick={onModelClick}
          onModelSettings={onModelSettings}
          onModelStarToggle={onModelStarToggle}
          onVendorSettings={onVendorSettings}
        />
      </TabsContent>
      <TabsContent value="assistants" className="mt-2">
        <AssistantList
          groups={assistantGroups}
          selectedAssistantId={selectedAssistantId}
          onAssistantClick={onAssistantClick}
          onAssistantSettings={onAssistantSettings}
          onAssistantStarToggle={onAssistantStarToggle}
          onAssistantDelete={onAssistantDelete}
          onGroupSettings={onGroupSettings}
        />
      </TabsContent>
      <TabsContent value="people" className="mt-2">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>No People Yet</EmptyTitle>
            <EmptyDescription>You haven&apos;t added any contacts yet.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </TabsContent>
    </Tabs>
  )
}
