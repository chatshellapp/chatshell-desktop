'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { ProviderForm } from '@/components/provider-settings-dialog/provider-form'
import { ModelsTable } from '@/components/provider-settings-dialog/models-table'
import { FetchModelsDialog } from '@/components/provider-settings-dialog/fetch-models-dialog'
import { useProviderSettings } from '@/components/provider-settings-dialog/use-provider-settings'
import { llmProviders } from '@/components/provider-settings-dialog/constants'

interface LLMProviderSettingsProps {
  open: boolean
}

export function LLMProviderSettings({ open }: LLMProviderSettingsProps) {
  const {
    selectedProvider,
    setSelectedProvider,
    apiKey,
    setApiKey,
    showApiKey,
    setShowApiKey,
    apiBaseUrl,
    setApiBaseUrl,
    models,
    fetchModalOpen,
    setFetchModalOpen,
    availableModels,
    isLoading,
    fetchError,
    modelSearchQuery,
    setModelSearchQuery,
    isSaving,
    existingProvider,
    modelsToDelete,
    originalModelNames,
    storeProviders,
    handleUpdateModelName,
    handleDeleteModel,
    handleModelSettings,
    handleFetchModels,
    handleOpenFetchModal,
    handleToggleImportModel,
    isModelImported,
    handleSave,
    groupedModels,
  } = useProviderSettings(open, () => {})

  const hasChanges =
    models.filter((m) => !m.isExisting).length > 0 ||
    modelsToDelete.length > 0 ||
    models.filter(
      (m) => m.isExisting && originalModelNames[m.id] && originalModelNames[m.id] !== m.displayName
    ).length > 0 ||
    (existingProvider &&
      (existingProvider.api_key !== apiKey || existingProvider.base_url !== apiBaseUrl))

  return (
    <div className="flex h-full">
      {/* Inner Provider Sidebar */}
      <Sidebar collapsible="none" className="w-[180px]">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {llmProviders.map((provider) => {
                  const hasExisting = storeProviders.some((p) => p.provider_type === provider.id)
                  return (
                    <SidebarMenuItem key={provider.id}>
                      <SidebarMenuButton
                        onClick={() => setSelectedProvider(provider)}
                        isActive={provider.id === selectedProvider.id}
                      >
                        <img src={provider.logo} alt={provider.name} className="size-4 rounded" />
                        <span>{provider.name}</span>
                        {hasExisting && (
                          <span className="ml-auto text-xs text-muted-foreground">●</span>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      {/* Provider Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">
                {existingProvider ? 'Edit' : 'Add'} {selectedProvider.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {existingProvider
                  ? `Select your ${selectedProvider.name} models`
                  : `Configure your ${selectedProvider.name} API settings`}
              </p>
            </div>

            <Separator />

            <ProviderForm
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              showApiKey={showApiKey}
              onShowApiKeyChange={setShowApiKey}
              apiBaseUrl={apiBaseUrl}
              onApiBaseUrlChange={setApiBaseUrl}
              selectedProvider={selectedProvider}
            />

            <ModelsTable
              models={models}
              selectedProvider={selectedProvider}
              apiKey={apiKey}
              onOpenFetchModal={handleOpenFetchModal}
              onUpdateModelName={handleUpdateModelName}
              onDeleteModel={handleDeleteModel}
              onModelSettings={handleModelSettings}
            />
          </div>
        </div>

        {/* Footer with Save Button */}
        <div className="shrink-0 border-t p-4 flex justify-end gap-2">
          <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
            {isSaving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : existingProvider ? (
              'Save'
            ) : (
              'Save Configuration'
            )}
          </Button>
        </div>
      </div>

      {/* Fetch Models Dialog */}
      <FetchModelsDialog
        open={fetchModalOpen}
        onOpenChange={setFetchModalOpen}
        selectedProvider={selectedProvider}
        isLoading={isLoading}
        fetchError={fetchError}
        availableModels={availableModels}
        modelSearchQuery={modelSearchQuery}
        onModelSearchQueryChange={setModelSearchQuery}
        groupedModels={groupedModels}
        onToggleImportModel={handleToggleImportModel}
        isModelImported={isModelImported}
        onRetry={handleFetchModels}
      />
    </div>
  )
}
