import { SlidersHorizontal, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PromptList, type Prompt, type PromptGroup } from '@/components/prompt-list'
import { PresetList } from '@/components/preset-list'
import type { LibraryTab } from '@/stores/librarySelectionStore'
import type { ModelParameterPreset } from '@/types'

interface LibraryContentProps {
  activeTab: LibraryTab
  onTabChange: (tab: LibraryTab) => void
  promptGroups: PromptGroup[]
  selectedPromptId?: string
  onPromptClick: (prompt: Prompt) => void
  onPromptActivate: (prompt: Prompt) => void
  onPromptSettings: (prompt: Prompt) => void
  onPromptStarToggle: (prompt: Prompt) => void
  onPromptDelete: (prompt: Prompt) => void
  onPromptGroupRename: (group: PromptGroup, newName: string) => void
  presets: ModelParameterPreset[]
  selectedPresetId?: string
  onPresetClick: (preset: ModelParameterPreset) => void
  onPresetActivate: (preset: ModelParameterPreset) => void
  onPresetSetDefault: (preset: ModelParameterPreset) => void
  onPresetEdit: (preset: ModelParameterPreset) => void
}

export function LibraryContent({
  activeTab,
  onTabChange,
  promptGroups,
  selectedPromptId,
  onPromptClick,
  onPromptActivate,
  onPromptSettings,
  onPromptStarToggle,
  onPromptDelete,
  onPromptGroupRename,
  presets,
  selectedPresetId,
  onPresetClick,
  onPresetActivate,
  onPresetSetDefault,
  onPresetEdit,
}: LibraryContentProps) {
  const { t } = useTranslation('sidebar')

  return (
    <Tabs
      value={activeTab}
      onValueChange={(tab) => onTabChange(tab as LibraryTab)}
      className="w-full p-2"
    >
      <TabsList className="w-full grid grid-cols-2 h-9">
        <TabsTrigger value="prompts" className="text-xs gap-1 px-2">
          <Sparkles className="size-3.5" />
          {t('prompts')}
        </TabsTrigger>
        <TabsTrigger value="presets" className="text-xs gap-1 px-2">
          <SlidersHorizontal className="size-3.5" />
          {t('presets')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="prompts" className="mt-2">
        <PromptList
          groups={promptGroups}
          selectedPromptId={selectedPromptId}
          onPromptClick={onPromptClick}
          onPromptActivate={onPromptActivate}
          onPromptSettings={onPromptSettings}
          onPromptStarToggle={onPromptStarToggle}
          onPromptDelete={onPromptDelete}
          onGroupRename={onPromptGroupRename}
        />
      </TabsContent>
      <TabsContent value="presets" className="mt-2">
        <PresetList
          presets={presets}
          selectedPresetId={selectedPresetId}
          onPresetClick={onPresetClick}
          onPresetActivate={onPresetActivate}
          onPresetSetDefault={onPresetSetDefault}
          onPresetEdit={onPresetEdit}
        />
      </TabsContent>
    </Tabs>
  )
}
