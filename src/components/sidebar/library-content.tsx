import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PromptList, type Prompt, type PromptGroup } from '@/components/prompt-list'

interface LibraryContentProps {
  activeTab: string
  onTabChange: (tab: string) => void
  promptGroups: PromptGroup[]
  selectedPromptId?: string
  onPromptClick: (prompt: Prompt) => void
  onPromptSettings: (prompt: Prompt) => void
  onPromptStarToggle: (prompt: Prompt) => void
  onPromptDelete: (prompt: Prompt) => void
  onPromptGroupSettings: (group: PromptGroup) => void
}

export function LibraryContent({
  activeTab,
  onTabChange,
  promptGroups,
  selectedPromptId,
  onPromptClick,
  onPromptSettings,
  onPromptStarToggle,
  onPromptDelete,
  onPromptGroupSettings,
}: LibraryContentProps) {
  const { t } = useTranslation('sidebar')

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full p-2">
      <TabsList className="w-full grid h-9">
        <TabsTrigger value="prompts" className="text-xs gap-1 px-2">
          <Sparkles className="size-3.5" />
          {t('prompts')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="prompts" className="mt-2">
        <PromptList
          groups={promptGroups}
          selectedPromptId={selectedPromptId}
          onPromptClick={onPromptClick}
          onPromptSettings={onPromptSettings}
          onPromptStarToggle={onPromptStarToggle}
          onPromptDelete={onPromptDelete}
          onGroupSettings={onPromptGroupSettings}
        />
      </TabsContent>
    </Tabs>
  )
}
