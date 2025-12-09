'use client'

import * as React from 'react'
import { Plus, MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  useSidebar,
} from '@/components/ui/sidebar'
import { ProviderSettingsDialog } from '@/components/provider-settings-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import { AssistantDialog } from '@/components/assistant-dialog'
import { PromptDialog } from '@/components/prompt-dialog'
import { ConversationList } from '@/components/sidebar/conversation-list'
import { ContactsContent } from '@/components/sidebar/contacts-content'
import { LibraryContent } from '@/components/sidebar/library-content'
import { ArtifactsContent } from '@/components/sidebar/artifacts-content'
import { SidebarNavigation } from '@/components/sidebar/sidebar-navigation'
import { useConversationParticipants } from '@/hooks/useConversationParticipants'
import { useSidebarHandlers } from '@/hooks/useSidebarHandlers'
import { useVendorsList } from '@/hooks/useVendorsList'
import { useAssistantGroups } from '@/hooks/useAssistantGroups'
import { useConversationStore } from '@/stores/conversation'
import { useAssistantStore } from '@/stores/assistantStore'
import { usePromptStore } from '@/stores/promptStore'
import { SIDEBAR_DATA } from '@/lib/sidebar-data'
import type { Prompt as PromptListItem, PromptGroup } from '@/components/prompt-list'
import type { Model as ModelListItem } from '@/components/model-list'
import type { Assistant as AssistantListItem } from '@/components/assistant-list'
import type { Assistant as AssistantDB } from '@/types/assistant'
import type { Prompt as PromptDB } from '@/types/prompt'
import type { NavItem } from '@/components/sidebar/sidebar-navigation'
import { logger } from '@/lib/logger'

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [activeItem, setActiveItem] = React.useState<NavItem>(SIDEBAR_DATA.navMain[0])
  const [selectedPromptId, setSelectedPromptId] = React.useState<string | null>(null)
  const [providerDialogOpen, setProviderDialogOpen] = React.useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = React.useState(false)
  const [assistantDialogOpen, setAssistantDialogOpen] = React.useState(false)
  const [promptDialogOpen, setPromptDialogOpen] = React.useState(false)
  const [editingAssistant, setEditingAssistant] = React.useState<AssistantDB | null>(null)
  const [editingPrompt, setEditingPrompt] = React.useState<PromptDB | null>(null)
  const [promptDialogMode, setPromptDialogMode] = React.useState<'create' | 'edit'>('create')
  const [activeContactsTab, setActiveContactsTab] = React.useState('models')
  const [activeLibraryTab, setActiveLibraryTab] = React.useState('prompts')
  const { setOpen } = useSidebar()

  const { conversationParticipantsMap } = useConversationParticipants()
  const vendorsList = useVendorsList()
  const assistantGroups = useAssistantGroups()

  const assistants = useAssistantStore((state) => state.assistants)
  const prompts = usePromptStore((state) => state.prompts)
  const ensurePromptsLoaded = usePromptStore((state) => state.ensureLoaded)
  const selectedModel = useConversationStore((state) => state.selectedModel)
  const selectedAssistant = useConversationStore((state) => state.selectedAssistant)

  // Ensure prompts are loaded (handles HMR store reset)
  React.useEffect(() => {
    ensurePromptsLoaded()
  }, [ensurePromptsLoaded])

  // Transform database prompts into prompt groups by category
  const promptGroups = React.useMemo((): PromptGroup[] => {
    const groupsMap = new Map<string, PromptGroup>()

    prompts.forEach((prompt) => {
      const category = prompt.category || 'Uncategorized'

      if (!groupsMap.has(category)) {
        groupsMap.set(category, {
          id: category.toLowerCase().replace(/\s+/g, '-'),
          name: category,
          defaultOpen: true, // Set to true so groups are visible by default
          prompts: [],
        })
      }

      groupsMap.get(category)!.prompts.push({
        id: prompt.id,
        name: prompt.name,
        content: prompt.content,
        isStarred: false, // TODO: Add isStarred to database schema if needed
      })
    })

    return Array.from(groupsMap.values())
  }, [prompts])

  const handlers = useSidebarHandlers()

  const renderContent = () => {
    switch (activeItem.title) {
      case 'Conversations':
        return (
          <ConversationList
            conversationParticipantsMap={conversationParticipantsMap}
            onConversationClick={handlers.handleConversationClick}
            onGenerateTitle={handlers.handleGenerateTitle}
            onEditTitle={handlers.handleEditTitle}
            onDelete={handlers.handleDeleteConversation}
          />
        )
      case 'Contacts':
        return (
          <ContactsContent
            activeTab={activeContactsTab}
            onTabChange={setActiveContactsTab}
            vendorsList={vendorsList}
            assistantGroups={assistantGroups}
            selectedModelId={selectedModel?.id || selectedAssistant?.model_id}
            selectedAssistantId={selectedAssistant?.id}
            onModelClick={(model: ModelListItem) => handlers.handleModelClick(model)}
            onModelSettings={(model: ModelListItem) => handlers.handleModelDelete(model)}
            onModelStarToggle={(model: ModelListItem) => handlers.handleModelStarToggle(model)}
            onVendorSettings={() => {}}
            onAssistantClick={(assistant: AssistantListItem) =>
              handlers.handleAssistantClick(assistant)
            }
            onAssistantSettings={(assistant: AssistantListItem) => {
              // Find the full assistant from the store
              const fullAssistant = assistants.find((a) => a.id === assistant.id)
              if (fullAssistant) {
                setEditingAssistant(fullAssistant)
                setAssistantDialogOpen(true)
              }
            }}
            onAssistantStarToggle={(assistant: AssistantListItem) =>
              handlers.handleAssistantStarToggle(assistant)
            }
            onAssistantDelete={(assistant: AssistantListItem) =>
              handlers.handleAssistantDelete(assistant)
            }
            onGroupSettings={() => {}}
          />
        )
      case 'Library':
        return (
          <LibraryContent
            activeTab={activeLibraryTab}
            onTabChange={setActiveLibraryTab}
            promptGroups={promptGroups}
            selectedPromptId={selectedPromptId || undefined}
            onPromptClick={(prompt: PromptListItem) => setSelectedPromptId(prompt.id)}
            onPromptSettings={(prompt: PromptListItem) => {
              // Find the full prompt from the store
              const fullPrompt = prompts.find((p) => p.id === prompt.id)
              if (fullPrompt) {
                setEditingPrompt(fullPrompt)
                setPromptDialogMode('edit')
                setPromptDialogOpen(true)
              }
            }}
            onPromptStarToggle={(prompt: PromptListItem) => {
              // TODO: Implement star toggle in database
              logger.info('Star toggle for prompt:', prompt.id)
            }}
            onPromptDelete={(prompt: PromptListItem) => handlers.handlePromptDelete(prompt)}
            onPromptGroupSettings={() => {}}
          />
        )
      case 'Artifacts':
        return <ArtifactsContent />
      case 'Settings':
        return (
          <div className="p-4">
            <p className="text-sm text-muted-foreground">Settings panel coming soon...</p>
          </div>
        )
      default:
        return null
    }
  }

  const renderFooter = () => {
    switch (activeItem.title) {
      case 'Conversations':
        return (
          <div className="px-3 pt-2 pb-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-center gap-2 h-9"
              onClick={handlers.handleNewConversation}
            >
              <MessageSquarePlus className="size-4" />
              New Conversation
            </Button>
          </div>
        )
      case 'Contacts':
        switch (activeContactsTab) {
          case 'models':
            return (
              <div className="px-3 pt-2 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-center gap-2 h-9"
                  onClick={() => setProviderDialogOpen(true)}
                >
                  <Plus className="size-4" />
                  Add Models
                </Button>
              </div>
            )
          case 'assistants':
            return (
              <div className="px-3 pt-2 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-center gap-2 h-9"
                  onClick={() => {
                    setEditingAssistant(null)
                    setAssistantDialogOpen(true)
                  }}
                >
                  <Plus className="size-4" />
                  Add Assistant
                </Button>
              </div>
            )
          case 'people':
            return (
              <></>
              // <div className="px-3 pt-2 pb-2">
              //   <Button
              //     variant="outline"
              //     size="sm"
              //     className="w-full justify-center gap-2 h-9"
              //     onClick={() => {}}
              //   >
              //     <Plus className="size-4" />
              //     Add Contact
              //   </Button>
              // </div>
            )
        }
        break
      case 'Library':
        if (activeLibraryTab === 'prompts') {
          return (
            <div className="px-3 pt-2 pb-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-center gap-2 h-9"
                onClick={() => {
                  setEditingPrompt(null)
                  setPromptDialogMode('create')
                  setPromptDialogOpen(true)
                }}
              >
                <Plus className="size-4" />
                Add Prompt
              </Button>
            </div>
          )
        }
        break
      case 'Settings':
        return null
      default:
        return null
    }
    return null
  }

  return (
    <Sidebar
      collapsible="icon"
      className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
      {...props}
    >
      <SidebarNavigation
        navItems={SIDEBAR_DATA.navMain}
        activeItem={activeItem}
        onItemClick={(item) => {
          setActiveItem(item)
          setOpen(true)
        }}
        onSettingsClick={() => setSettingsDialogOpen(true)}
        onNewConversation={handlers.handleNewConversation}
        user={SIDEBAR_DATA.user}
      />

      <Sidebar collapsible="none" className="hidden flex-1 md:flex">
        <SidebarHeader className="gap-3.5 border-b p-4">
          <div className="flex w-full items-center justify-between h-7">
            <div className="text-foreground text-base font-medium">{activeItem?.title}</div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="px-0">
            <SidebarGroupContent>{renderContent()}</SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t">{renderFooter()}</SidebarFooter>
      </Sidebar>

      <ProviderSettingsDialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen} />

      <SettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />

      <AssistantDialog
        open={assistantDialogOpen}
        onOpenChange={setAssistantDialogOpen}
        assistant={editingAssistant}
        mode={editingAssistant ? 'edit' : 'create'}
      />

      <PromptDialog
        open={promptDialogOpen}
        onOpenChange={(open) => {
          setPromptDialogOpen(open)
          if (!open) {
            setEditingPrompt(null)
            setPromptDialogMode('create')
          }
        }}
        prompt={editingPrompt}
        mode={promptDialogMode}
      />
    </Sidebar>
  )
}
