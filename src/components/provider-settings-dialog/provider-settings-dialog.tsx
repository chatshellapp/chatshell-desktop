'use client'

import { Loader2 } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { SidebarProvider } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import type { ProviderSettingsDialogProps } from './types'
import { isCustomProvider } from './types'
import { useProviderSettings } from './useProviderSettings'
import { ProviderSidebar } from './provider-sidebar'
import { ProviderForm } from './provider-form'
import { ModelsTable } from './models-table'
import { FetchModelsDialog } from './fetch-models-dialog'
import { AddModelDialog } from './add-model-dialog'

export function ProviderSettingsDialog({ open, onOpenChange }: ProviderSettingsDialogProps) {
  const {
    selectedProvider,
    setSelectedProvider,
    apiKey,
    setApiKey,
    showApiKey,
    setShowApiKey,
    apiBaseUrl,
    setApiBaseUrl,
    providerName,
    setProviderName,
    apiStyle,
    setApiStyle,
    compatibilityType,
    setCompatibilityType,
    editingCustomProviderId,
    setEditingCustomProviderId,
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
    addModelDialogOpen,
    setAddModelDialogOpen,
    handleUpdateModelName,
    handleDeleteModel,
    handleModelSettings,
    handleFetchModels,
    handleOpenFetchModal,
    handleToggleImportModel,
    handleAddManualModel,
    isModelImported,
    handleSave,
    groupedModels,
  } = useProviderSettings(open, onOpenChange)

  const isCustom = isCustomProvider(selectedProvider)
  const displayName = existingProvider ? existingProvider.name : selectedProvider.name

  const effectiveProviderType = isCustom
    ? compatibilityType === 'anthropic'
      ? 'custom_anthropic'
      : 'custom_openai'
    : selectedProvider.id
  const effectiveApiStyle = isCustom && compatibilityType === 'openai' ? apiStyle : undefined

  const hasChanges =
    models.filter((m) => !m.isExisting).length > 0 ||
    modelsToDelete.length > 0 ||
    models.filter(
      (m) => m.isExisting && originalModelNames[m.id] && originalModelNames[m.id] !== m.displayName
    ).length > 0 ||
    (existingProvider &&
      (existingProvider.api_key !== apiKey ||
        existingProvider.base_url !== apiBaseUrl ||
        existingProvider.name !== (isCustom ? providerName : selectedProvider.name) ||
        existingProvider.provider_type !== effectiveProviderType ||
        existingProvider.api_style !== effectiveApiStyle)) ||
    (!existingProvider && isCustom)

  const handleSidebarSelect = (provider: typeof selectedProvider) => {
    setEditingCustomProviderId(null)
    setSelectedProvider(provider)
  }

  const handleCustomProviderSelect = (provider: typeof selectedProvider) => {
    const storeProvider = storeProviders.find(
      (p) => p.provider_type === provider.id && p.name === provider.name
    )
    if (storeProvider) {
      setEditingCustomProviderId(storeProvider.id)
    }
    setSelectedProvider(provider)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 gap-0 md:max-h-[600px] md:max-w-[700px] lg:max-w-[900px]">
        <DialogTitle className="sr-only">Add Models</DialogTitle>
        <DialogDescription className="sr-only">
          Configure your LLM provider settings here.
        </DialogDescription>
        <SidebarProvider className="items-start">
          <ProviderSidebar
            selectedProvider={selectedProvider}
            onSelectProvider={(p) => {
              if (p.isCustom) {
                handleCustomProviderSelect(p)
              } else {
                handleSidebarSelect(p)
              }
            }}
            storeProviders={storeProviders}
            editingCustomProviderId={editingCustomProviderId}
          />
          <main className="flex h-[600px] flex-1 flex-col overflow-hidden">
            <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2 px-4">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink href="#">Providers</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{displayName}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-6 pt-0">
              <div className="space-y-6">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">
                    {existingProvider ? 'Edit' : 'Add'} {displayName}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {existingProvider
                      ? `Manage your ${displayName} configuration and models`
                      : isCustom
                        ? 'Configure a custom provider endpoint'
                        : `Configure your ${displayName} API settings`}
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
                  providerName={providerName}
                  onProviderNameChange={setProviderName}
                  apiStyle={apiStyle}
                  onApiStyleChange={setApiStyle}
                  compatibilityType={compatibilityType}
                  onCompatibilityTypeChange={setCompatibilityType}
                />

                <ModelsTable
                  models={models}
                  selectedProvider={selectedProvider}
                  apiKey={apiKey}
                  onOpenFetchModal={handleOpenFetchModal}
                  onOpenAddModelDialog={() => setAddModelDialogOpen(true)}
                  onUpdateModelName={handleUpdateModelName}
                  onDeleteModel={handleDeleteModel}
                  onModelSettings={handleModelSettings}
                />
              </div>
            </div>
            <DialogFooter className="shrink-0 border-t p-4 sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                Cancel
              </Button>
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
            </DialogFooter>
          </main>
        </SidebarProvider>
      </DialogContent>

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
        onAddManually={() => {
          setFetchModalOpen(false)
          setAddModelDialogOpen(true)
        }}
      />

      {/* Manual Add Model Dialog */}
      <AddModelDialog
        open={addModelDialogOpen}
        onOpenChange={setAddModelDialogOpen}
        onAddModel={handleAddManualModel}
      />
    </Dialog>
  )
}
