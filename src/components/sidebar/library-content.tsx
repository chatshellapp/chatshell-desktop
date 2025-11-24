import { Sparkles, BookOpen, Plug, File } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PromptList, type Prompt, type PromptGroup } from "@/components/prompt-list"

interface LibraryContentProps {
  activeTab: string
  onTabChange: (tab: string) => void
  promptGroups: PromptGroup[]
  selectedPromptId?: string
  onPromptClick: (prompt: Prompt) => void
  onPromptSettings: (prompt: Prompt) => void
  onPromptStarToggle: (prompt: Prompt) => void
  onPromptGroupSettings: (group: PromptGroup) => void
  files: Array<{ id: string; name: string; type: string; size: string; lastModified: string }>
  tools: Array<{ id: string; name: string; description: string; status: string; lastSync: string }>
}

export function LibraryContent({
  activeTab,
  onTabChange,
  promptGroups,
  selectedPromptId,
  onPromptClick,
  onPromptSettings,
  onPromptStarToggle,
  onPromptGroupSettings,
  files,
  tools,
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
          onGroupSettings={onPromptGroupSettings}
        />
      </TabsContent>
      <TabsContent value="knowledge" className="mt-2">
        {files.map((file) => (
          <a
            href="#"
            key={file.id}
            className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-col items-start gap-2 border-b p-4 text-sm leading-tight last:border-b-0"
          >
            <div className="flex w-full items-center gap-2">
              <File className="size-4 text-muted-foreground" />
              <span className="font-medium">{file.name}</span>
            </div>
            <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
              <span>{file.type}</span>
              <span>•</span>
              <span>{file.size}</span>
              <span className="ml-auto">{file.lastModified}</span>
            </div>
          </a>
        ))}
      </TabsContent>
      <TabsContent value="tools" className="mt-2">
        {tools.map((tool) => (
          <a
            href="#"
            key={tool.id}
            className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-col items-start gap-2 border-b p-4 text-sm leading-tight last:border-b-0"
          >
            <div className="flex w-full items-center gap-2">
              <Plug className="size-4 text-muted-foreground" />
              <span className="font-medium">{tool.name}</span>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded ${
                tool.status === "connected" 
                  ? "bg-green-500/10 text-green-500" 
                  : "bg-red-500/10 text-red-500"
              }`}>
                {tool.status}
              </span>
            </div>
            <span className="text-muted-foreground text-xs line-clamp-2">
              {tool.description}
            </span>
            <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
              <span>Last sync: {tool.lastSync}</span>
            </div>
          </a>
        ))}
      </TabsContent>
    </Tabs>
  )
}

