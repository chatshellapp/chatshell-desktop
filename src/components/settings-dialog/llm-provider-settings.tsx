'use client'

import { useTranslation } from 'react-i18next'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { ProviderForm } from '@/components/provider-settings-dialog/provider-form'
import { ModelsTable } from '@/components/provider-settings-dialog/models-table'
import { FetchModelsDialog } from '@/components/provider-settings-dialog/fetch-models-dialog'
import { AddModelDialog } from '@/components/provider-settings-dialog/add-model-dialog'
import { EditModelDialog } from '@/components/provider-settings-dialog/edit-model-dialog'
import { useProviderSettings } from '@/components/provider-settings-dialog/useProviderSettings'
import { BUILTIN_PROVIDERS, CUSTOM_PROVIDER } from '@/components/provider-settings-dialog/constants'
import { ProviderLogo } from '@/components/provider-settings-dialog/provider-logo'
import { isCustomProvider, isCustomProviderType } from '@/components/provider-settings-dialog/types'

interface LLMProviderSettingsProps {
  open: boolean
}

export function LLMProviderSettings({ open }: LLMProviderSettingsProps) {
  const { t } = useTranslation('providers')
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
    originalModelIds,
    storeProviders,
    addModelDialogOpen,
    setAddModelDialogOpen,
    editModelDialogOpen,
    setEditModelDialogOpen,
    editingModel,
    handleEditModelSave,
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
  } = useProviderSettings(open, () => {})

  const isCustom = isCustomProvider(selectedProvider)
  const displayName = existingProvider ? existingProvider.name : selectedProvider.name
  const customStoreProviders = storeProviders.filter((p) => isCustomProviderType(p.provider_type))

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
      (m) =>
        m.isExisting &&
        (originalModelNames[m.id] !== m.displayName || originalModelIds[m.id] !== m.modelId)
    ).length > 0 ||
    (existingProvider &&
      (existingProvider.api_key !== apiKey ||
        existingProvider.base_url !== apiBaseUrl ||
        existingProvider.name !== (isCustom ? providerName : selectedProvider.name) ||
        existingProvider.provider_type !== effectiveProviderType ||
        existingProvider.api_style !== effectiveApiStyle)) ||
    (!existingProvider && isCustom)

  return (
    <div className="flex h-full">
      {/* Inner Provider Sidebar */}
      <Sidebar collapsible="none" className="w-[180px]">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {BUILTIN_PROVIDERS.map((provider) => {
                  const hasExisting = storeProviders.some((p) => p.provider_type === provider.id)
                  return (
                    <SidebarMenuItem key={provider.id}>
                      <SidebarMenuButton
                        onClick={() => {
                          setEditingCustomProviderId(null)
                          setSelectedProvider(provider)
                        }}
                        isActive={provider.id === selectedProvider.id && !editingCustomProviderId}
                      >
                        <ProviderLogo providerType={provider.id} />
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

          <SidebarGroup>
            <SidebarGroupLabel>{t('common:custom', 'Custom')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {customStoreProviders.map((cp) => (
                  <SidebarMenuItem key={cp.id}>
                    <SidebarMenuButton
                      onClick={() => {
                        setEditingCustomProviderId(cp.id)
                        setSelectedProvider({
                          id: cp.provider_type,
                          name: cp.name,
                          baseUrl: cp.base_url || '',
                          isCustom: true,
                        })
                      }}
                      isActive={editingCustomProviderId === cp.id}
                    >
                      <ProviderLogo providerType={cp.provider_type} name={cp.name} />
                      <span className="truncate">{cp.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">●</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}

                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => {
                      setEditingCustomProviderId(null)
                      setSelectedProvider(CUSTOM_PROVIDER)
                    }}
                    isActive={selectedProvider.id === 'custom' && !editingCustomProviderId}
                  >
                    <Plus className="size-4" />
                    <span>{t('addProvider')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
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
                {existingProvider ? t('common:edit') : t('common:add')} {displayName}
              </h3>
              <p className="text-sm text-muted-foreground">
                {existingProvider
                  ? t('manageProviderDescription', { name: displayName })
                  : isCustom
                    ? t('configureCustomEndpoint')
                    : t('configureApiSettings', { name: displayName })}
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
              models={models}
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

        {/* Footer with Save Button */}
        <div className="shrink-0 border-t p-4 flex justify-end gap-2">
          <Button
            onClick={handleSave}
            disabled={
              isSaving || !hasChanges || (selectedProvider.id !== 'ollama' && !apiKey.trim())
            }
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {t('common:saving')}
              </>
            ) : existingProvider ? (
              t('common:save')
            ) : (
              t('saveConfiguration')
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

      {/* Edit Model Dialog */}
      <EditModelDialog
        open={editModelDialogOpen}
        model={editingModel}
        onOpenChange={setEditModelDialogOpen}
        onSave={handleEditModelSave}
      />
    </div>
  )
}
