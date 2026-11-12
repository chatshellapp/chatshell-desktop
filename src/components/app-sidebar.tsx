'use client'

import * as React from 'react'
import { Plus, MessageSquarePlus, Search } from 'lucide-react'
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
import { useSearchStore } from '@/stores/searchStore'
import { useContactSelectionStore } from '@/stores/contactSelectionStore'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import { usePromptGroups } from '@/hooks/usePromptGroups'
import { usePresetActions } from '@/hooks/usePresets'
import { usePresetStore } from '@/stores/presetStore'
import { PresetDialog } from '@/components/preset-dialog'
import { useAssistantStore } from '@/stores/assistantStore'
import { useTranslation } from 'react-i18next'
import { usePromptStore } from '@/stores/promptStore'
import { useProviderSettingsStore } from '@/stores/providerSettingsStore'
import { SIDEBAR_DATA, getNavItems } from '@/lib/sidebar-data'
import type { Prompt as PromptListItem } from '@/components/prompt-list'
import type { Model as ModelListItem } from '@/components/model-list'
import type { Assistant as AssistantListItem } from '@/components/assistant-list'
import type { Assistant as AssistantDB } from '@/types/assistant'
import type { Prompt as PromptDB } from '@/types/prompt'
import type { ModelParameterPreset } from '@/types'

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  activeSection: string
  onSectionChange: (section: string) => void
}

export function AppSidebar({ activeSection, onSectionChange, ...props }: AppSidebarProps) {
  const { t } = useTranslation()
  const navItems = React.useMemo(() => getNavItems(t), [t])
  const activeItem = navItems.find((item) => item.id === activeSection) || navItems[0]
  const [settingsDialogOpen, setSettingsDialogOpen] = React.useState(false)
  const [assistantDialogOpen, setAssistantDialogOpen] = React.useState(false)
  const [promptDialogOpen, setPromptDialogOpen] = React.useState(false)
  const [editingAssistant, setEditingAssistant] = React.useState<AssistantDB | null>(null)
  const [editingPrompt, setEditingPrompt] = React.useState<PromptDB | null>(null)
  const [promptDialogMode, setPromptDialogMode] = React.useState<'create' | 'edit'>('create')
  const activeContactsTab = useContactSelectionStore((state) => state.activeTab)
  const setActiveContactsTab = useContactSelectionStore((state) => state.setActiveTab)
  const { setOpen, setOpenMobile } = useSidebar()
  const providerDialogOpen = useProviderSettingsStore((state) => state.open)
  const providerDialogInitialId = useProviderSettingsStore((state) => state.initialProviderId)
  const openProviderSettings = useProviderSettingsStore((state) => state.openProviderSettings)
  const closeProviderSettings = useProviderSettingsStore((state) => state.closeProviderSettings)

  const { conversationParticipantsMap } = useConversationParticipants()
  const vendorsList = useVendorsList()
  const assistantGroups = useAssistantGroups()

  const assistants = useAssistantStore((state) => state.assistants)
  const prompts = usePromptStore((state) => state.prompts)
  const ensurePromptsLoaded = usePromptStore((state) => state.ensureLoaded)
  const togglePromptStar = usePromptStore((state) => state.togglePromptStar)
  const selectedContact = useContactSelectionStore((state) => state.selected)
  const selectContact = useContactSelectionStore((state) => state.selectContact)
  const selectedPromptId = useLibrarySelectionStore((state) => state.selectedPromptId)
  const selectPrompt = useLibrarySelectionStore((state) => state.selectPrompt)
  const activeLibraryTab = useLibrarySelectionStore((state) => state.activeTab)
  const setActiveLibraryTab = useLibrarySelectionStore((state) => state.setActiveTab)
  const selectedPresetId = useLibrarySelectionStore((state) => state.selectedPresetId)
  const selectPreset = useLibrarySelectionStore((state) => state.selectPreset)
  const presets = usePresetStore((state) => state.presets)
  const presetActions = usePresetActions()
  const [presetDialogOpen, setPresetDialogOpen] = React.useState(false)
  const [editingPreset, setEditingPreset] = React.useState<ModelParameterPreset | null>(null)

  // Ensure prompts are loaded (handles HMR store reset)
  React.useEffect(() => {
    ensurePromptsLoaded()
  }, [ensurePromptsLoaded])

  const promptGroups = usePromptGroups()

  const handlers = useSidebarHandlers()

  const renderContent = () => {
    switch (activeItem.id) {
      case 'conversations':
        return (
          <ConversationList
            conversationParticipantsMap={conversationParticipantsMap}
            onConversationClick={handlers.handleConversationClick}
            onGenerateTitle={handlers.handleGenerateTitle}
            onEditTitle={handlers.handleEditTitle}
            onDelete={handlers.handleDeleteConversation}
          />
        )
      case 'contacts':
        return (
          <ContactsContent
            activeTab={activeContactsTab}
            onTabChange={setActiveContactsTab}
            vendorsList={vendorsList}
            assistantGroups={assistantGroups}
            selectedModelId={selectedContact?.kind === 'model' ? selectedContact.id : undefined}
            selectedAssistantId={
              selectedContact?.kind === 'assistant' ? selectedContact.id : undefined
            }
            onModelClick={(model: ModelListItem) => selectContact({ kind: 'model', id: model.id })}
            onModelActivate={(model: ModelListItem) => {
              void handlers.handleModelClick(model)
              onSectionChange('conversations')
            }}
            onModelSettings={(model: ModelListItem) => openProviderSettings(model.providerId)}
            onModelDelete={(model: ModelListItem) => handlers.handleModelDelete(model)}
            onModelStarToggle={(model: ModelListItem) => handlers.handleModelStarToggle(model)}
            onVendorSettings={(vendor) => openProviderSettings(vendor.id)}
            onAssistantClick={(assistant: AssistantListItem) =>
              selectContact({ kind: 'assistant', id: assistant.id })
            }
            onAssistantActivate={(assistant: AssistantListItem) => {
              void handlers.handleAssistantClick(assistant)
              onSectionChange('conversations')
            }}
            onAssistantSettings={(assistant: AssistantListItem) => {
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
            onGroupRename={(group, newName) => {
              void handlers.handleAssistantGroupRename(group, newName)
            }}
          />
        )
      case 'library':
        return (
          <LibraryContent
            activeTab={activeLibraryTab}
            onTabChange={setActiveLibraryTab}
            promptGroups={promptGroups}
            selectedPromptId={selectedPromptId || undefined}
            onPromptClick={(prompt: PromptListItem) => selectPrompt(prompt.id)}
            onPromptActivate={(prompt: PromptListItem) => {
              void handlers.handlePromptUse(prompt)
              onSectionChange('conversations')
            }}
            onPromptSettings={(prompt: PromptListItem) => {
              const fullPrompt = prompts.find((p) => p.id === prompt.id)
              if (fullPrompt) {
                setEditingPrompt(fullPrompt)
                setPromptDialogMode('edit')
                setPromptDialogOpen(true)
              }
            }}
            onPromptStarToggle={(prompt: PromptListItem) => {
              togglePromptStar(prompt.id)
            }}
            onPromptDelete={(prompt: PromptListItem) => handlers.handlePromptDelete(prompt)}
            onPromptGroupRename={(group, newName) => {
              void handlers.handlePromptCategoryRename(group, newName)
            }}
            presets={presets}
            selectedPresetId={selectedPresetId ?? undefined}
            onPresetClick={(preset) => selectPreset(preset.id)}
            onPresetActivate={(preset) => {
              void presetActions.startChatWithPreset(preset)
              onSectionChange('conversations')
            }}
            onPresetSetDefault={(preset) => void presetActions.setDefaultPreset(preset)}
            onPresetEdit={(preset) => {
              setEditingPreset(preset)
              setPresetDialogOpen(true)
            }}
          />
        )
      case 'artifacts':
        return <ArtifactsContent />
      case 'settings':
        return (
          <div className="p-4">
            <p className="text-sm text-muted-foreground">{t('settingsComingSoon')}</p>
          </div>
        )
      default:
        return null
    }
  }

  const renderFooter = () => {
    switch (activeItem.id) {
      case 'conversations':
        return (
          <div className="px-3 pt-2 pb-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-center gap-2 h-9"
              onClick={handlers.handleNewConversation}
            >
              <MessageSquarePlus className="size-4" />
              {t('sidebar:newConversation')}
            </Button>
          </div>
        )
      case 'contacts':
        switch (activeContactsTab) {
          case 'models':
            return (
              <div className="px-3 pt-2 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-center gap-2 h-9"
                  onClick={() => openProviderSettings()}
                >
                  <Plus className="size-4" />
                  {t('sidebar:addModels')}
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
                  {t('sidebar:addAssistant')}
                </Button>
              </div>
            )
          case 'people':
            return <></>
        }
        break
      case 'library':
        return (
          <div className="px-3 pt-2 pb-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-center gap-2 h-9"
              onClick={() => {
                if (activeLibraryTab === 'presets') {
                  setEditingPreset(null)
                  setPresetDialogOpen(true)
                  return
                }
                setEditingPrompt(null)
                setPromptDialogMode('create')
                setPromptDialogOpen(true)
              }}
            >
              <Plus className="size-4" />
              {activeLibraryTab === 'presets' ? t('sidebar:addPreset') : t('sidebar:addPrompt')}
            </Button>
          </div>
        )
      case 'settings':
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
      style={
        activeSection === 'translation'
          ? ({ '--sidebar-width': 'var(--sidebar-width-icon)' } as React.CSSProperties)
          : undefined
      }
      {...props}
    >
      <SidebarNavigation
        navItems={navItems}
        activeItem={activeItem}
        onItemClick={(item) => {
          onSectionChange(item.id)
          setOpen(item.id !== 'translation')
          setOpenMobile(false)
        }}
        onSettingsClick={() => setSettingsDialogOpen(true)}
        onNewConversation={() => {
          onSectionChange('conversations')
          handlers.handleNewConversation()
        }}
        user={SIDEBAR_DATA.user}
      />

      {activeSection !== 'translation' && (
        <Sidebar collapsible="none" className="hidden flex-1 md:flex">
          <SidebarHeader className="gap-3.5 border-b p-4">
            <div className="flex w-full items-center justify-between h-7">
              <div className="text-foreground text-base font-medium">{activeItem?.title}</div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => useSearchStore.getState().setOpen(true)}
                aria-label="Search chat history"
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup className="px-0">
              <SidebarGroupContent>{renderContent()}</SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-t">{renderFooter()}</SidebarFooter>
        </Sidebar>
      )}

      <ProviderSettingsDialog
        open={providerDialogOpen}
        initialProviderId={providerDialogInitialId}
        onOpenChange={(open) => {
          if (open) openProviderSettings(providerDialogInitialId)
          else closeProviderSettings()
        }}
      />

      <SettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />

      <AssistantDialog
        open={assistantDialogOpen}
        onOpenChange={setAssistantDialogOpen}
        assistant={editingAssistant}
        mode={editingAssistant ? 'edit' : 'create'}
      />

      <PresetDialog
        open={presetDialogOpen}
        onOpenChange={(open) => {
          setPresetDialogOpen(open)
          if (!open) setEditingPreset(null)
        }}
        preset={editingPreset}
        onSaved={(preset) => selectPreset(preset.id)}
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
