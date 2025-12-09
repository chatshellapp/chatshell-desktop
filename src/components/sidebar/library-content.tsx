import { Sparkles, BookOpen, Plug } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PromptList, type Prompt, type PromptGroup } from '@/components/prompt-list'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

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
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full p-2">
      <TabsList className="w-full grid grid-cols-3 h-9">
        <TabsTrigger value="prompts" className="text-xs gap-1 px-2">
          <Sparkles className="size-3.5" />
          Prompts
        </TabsTrigger>
        <TabsTrigger value="knowledge" className="text-xs gap-1 px-2">
          <BookOpen className="size-3.5" />
          Knowledge
        </TabsTrigger>
        <TabsTrigger value="tools" className="text-xs gap-1 px-2">
          <Plug className="size-3.5" />
          Tools
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
      <TabsContent value="knowledge" className="mt-2">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpen />
            </EmptyMedia>
            <EmptyTitle>No Knowledge Yet</EmptyTitle>
            <EmptyDescription>
              You haven&apos;t added any knowledge base yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </TabsContent>
      <TabsContent value="tools" className="mt-2">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Plug />
            </EmptyMedia>
            <EmptyTitle>No Tools Yet</EmptyTitle>
            <EmptyDescription>
              You haven&apos;t configured any tools yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </TabsContent>
    </Tabs>
  )
}
