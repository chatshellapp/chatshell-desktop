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
import { useProviderSettings } from './use-provider-settings'
import { ProviderSidebar } from './provider-sidebar'
import { ProviderForm } from './provider-form'
import { ModelsTable } from './models-table'
import { FetchModelsDialog } from './fetch-models-dialog'

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
  } = useProviderSettings(open, onOpenChange)

  const hasChanges =
    models.filter((m) => !m.isExisting).length > 0 ||
    modelsToDelete.length > 0 ||
    models.filter(
      (m) => m.isExisting && originalModelNames[m.id] && originalModelNames[m.id] !== m.displayName
    ).length > 0 ||
    (existingProvider &&
      (existingProvider.api_key !== apiKey || existingProvider.base_url !== apiBaseUrl))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 gap-0 md:max-h-[600px] md:max-w-[700px] lg:max-w-[900px]">
        <DialogTitle className="sr-only">Add LLM Provider</DialogTitle>
        <DialogDescription className="sr-only">
          Configure your LLM provider settings here.
        </DialogDescription>
        <SidebarProvider className="items-start">
          <ProviderSidebar
            selectedProvider={selectedProvider}
            onSelectProvider={setSelectedProvider}
            storeProviders={storeProviders}
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
                      <BreadcrumbPage>{selectedProvider.name}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-6 pt-0">
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
      />
    </Dialog>
  )
}

