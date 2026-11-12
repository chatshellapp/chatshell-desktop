import { Bot, Drama, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ModelList, type Model, type ModelVendor } from '@/components/model-list'
import { AssistantList, type Assistant, type AssistantGroup } from '@/components/assistant-list'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { ContactsTab } from '@/stores/contactSelectionStore'

interface ContactsContentProps {
  activeTab: ContactsTab
  onTabChange: (tab: ContactsTab) => void
  vendorsList: ModelVendor[]
  assistantGroups: AssistantGroup[]
  selectedModelId?: string
  selectedAssistantId?: string
  onModelClick: (model: Model) => void
  onModelActivate: (model: Model) => void
  onModelSettings: (model: Model) => void
  onModelDelete: (model: Model) => void
  onModelStarToggle: (model: Model) => void
  onVendorSettings: (vendor: ModelVendor) => void
  onAssistantClick: (assistant: Assistant) => void
  onAssistantActivate: (assistant: Assistant) => void
  onAssistantSettings: (assistant: Assistant) => void
  onAssistantStarToggle: (assistant: Assistant) => void
  onAssistantDelete: (assistant: Assistant) => void
  onGroupRename: (group: AssistantGroup, newName: string) => void
}

export function ContactsContent({
  activeTab,
  onTabChange,
  vendorsList,
  assistantGroups,
  selectedModelId,
  selectedAssistantId,
  onModelClick,
  onModelActivate,
  onModelSettings,
  onModelDelete,
  onModelStarToggle,
  onVendorSettings,
  onAssistantClick,
  onAssistantActivate,
  onAssistantSettings,
  onAssistantStarToggle,
  onAssistantDelete,
  onGroupRename,
}: ContactsContentProps) {
  const { t } = useTranslation('sidebar')

  return (
    <Tabs
      value={activeTab}
      onValueChange={(tab) => onTabChange(tab as ContactsTab)}
      className="w-full p-2"
    >
      <TabsList className="w-full grid grid-cols-3 h-9">
        <TabsTrigger value="models" className="text-xs gap-1 px-2">
          <Bot className="size-3.5" />
          {t('models')}
        </TabsTrigger>
        <TabsTrigger value="assistants" className="text-xs gap-1 px-2">
          <Drama className="size-3.5" />
          {t('assistants')}
        </TabsTrigger>
        <TabsTrigger value="people" className="text-xs gap-1 px-2">
          <Users className="size-3.5" />
          {t('people')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="models" className="mt-2">
        <ModelList
          vendors={vendorsList}
          selectedModelId={selectedModelId}
          onModelClick={onModelClick}
          onModelActivate={onModelActivate}
          onModelSettings={onModelSettings}
          onModelDelete={onModelDelete}
          onModelStarToggle={onModelStarToggle}
          onVendorSettings={onVendorSettings}
        />
      </TabsContent>
      <TabsContent value="assistants" className="mt-2">
        <AssistantList
          groups={assistantGroups}
          selectedAssistantId={selectedAssistantId}
          onAssistantClick={onAssistantClick}
          onAssistantActivate={onAssistantActivate}
          onAssistantSettings={onAssistantSettings}
          onAssistantStarToggle={onAssistantStarToggle}
          onAssistantDelete={onAssistantDelete}
          onGroupRename={onGroupRename}
        />
      </TabsContent>
      <TabsContent value="people" className="mt-2">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>{t('noPeople')}</EmptyTitle>
            <EmptyDescription>{t('noContactsDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </TabsContent>
    </Tabs>
  )
}
