import { SlidersHorizontal, Sparkles, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PromptList, type Prompt, type PromptGroup } from '@/components/prompt-list'
import { PresetList } from '@/components/preset-list'
import { SkillList } from '@/components/skill-list'
import type { LibraryTab } from '@/stores/librarySelectionStore'
import { FilterNoMatches } from './filter-no-matches'
import type { ModelParameterPreset, Skill } from '@/types'

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
  skills: Skill[]
  selectedSkillId?: string
  onSkillClick: (skill: Skill) => void
  onSkillToggle: (skill: Skill) => void
  /** The header filter is active; lists arrive already filtered */
  filterActive?: boolean
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
  skills,
  selectedSkillId,
  onSkillClick,
  onSkillToggle,
  filterActive = false,
}: LibraryContentProps) {
  const { t } = useTranslation('sidebar')
  const { t: tSkills } = useTranslation('skills')

  return (
    <Tabs
      value={activeTab}
      onValueChange={(tab) => onTabChange(tab as LibraryTab)}
      className="w-full min-w-0 p-2"
    >
      <TabsList className="w-full grid grid-cols-3 h-9">
        <TabsTrigger value="prompts" className="text-xs gap-1 px-2">
          <Sparkles className="size-3.5" />
          {t('prompts')}
        </TabsTrigger>
        <TabsTrigger value="skills" className="text-xs gap-1 px-2">
          <Zap className="size-3.5" />
          {tSkills('skills')}
        </TabsTrigger>
        <TabsTrigger value="presets" className="text-xs gap-1 px-2">
          <SlidersHorizontal className="size-3.5" />
          {t('presets')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="prompts" className="mt-2">
        {filterActive && promptGroups.length === 0 ? (
          <FilterNoMatches />
        ) : (
          <PromptList
            filtering={filterActive}
            groups={promptGroups}
            selectedPromptId={selectedPromptId}
            onPromptClick={onPromptClick}
            onPromptActivate={onPromptActivate}
            onPromptSettings={onPromptSettings}
            onPromptStarToggle={onPromptStarToggle}
            onPromptDelete={onPromptDelete}
            onGroupRename={onPromptGroupRename}
          />
        )}
      </TabsContent>
      <TabsContent value="skills" className="mt-2 min-w-0">
        {filterActive && skills.length === 0 ? (
          <FilterNoMatches />
        ) : (
          <SkillList
            skills={skills}
            selectedSkillId={selectedSkillId}
            onSkillClick={onSkillClick}
            onSkillToggle={onSkillToggle}
          />
        )}
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
