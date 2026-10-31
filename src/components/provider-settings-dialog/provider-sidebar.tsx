'use client'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Plus } from 'lucide-react'
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
import type { Provider } from '@/types'
import type { LLMProvider } from './types'
import { isCustomProviderType } from './types'
import { BUILTIN_PROVIDERS, CUSTOM_PROVIDER } from './constants'
import { ProviderLogo } from './provider-logo'
import { useModelStore } from '@/stores/modelStore'
import { modelCountsByProvider } from '@/lib/model-setup'

interface ProviderSidebarProps {
  selectedProvider: LLMProvider
  onSelectProvider: (provider: LLMProvider) => void
  storeProviders: Provider[]
  editingCustomProviderId?: string | null
}

export function ProviderSidebar({
  selectedProvider,
  onSelectProvider,
  storeProviders,
  editingCustomProviderId,
}: ProviderSidebarProps) {
  const { t } = useTranslation('providers')
  const models = useModelStore((state) => state.models)
  const modelCounts = useMemo(() => modelCountsByProvider(models), [models])
  const customStoreProviders = storeProviders.filter((p) => isCustomProviderType(p.provider_type))

  return (
    <Sidebar collapsible="none" className="hidden md:flex h-[600px]">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {BUILTIN_PROVIDERS.map((provider) => {
                const savedProvider = storeProviders.find((p) => p.provider_type === provider.id)
                return (
                  <SidebarMenuItem key={provider.id}>
                    <SidebarMenuButton
                      onClick={() => onSelectProvider(provider)}
                      isActive={provider.id === selectedProvider.id && !editingCustomProviderId}
                    >
                      <ProviderLogo providerType={provider.id} />
                      <span>{provider.name}</span>
                      {savedProvider && (
                        <ProviderStatus count={modelCounts[savedProvider.id] ?? 0} />
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{t('custom')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {customStoreProviders.map((cp) => (
                <SidebarMenuItem key={cp.id}>
                  <SidebarMenuButton
                    onClick={() =>
                      onSelectProvider({
                        id: cp.provider_type,
                        name: cp.name,
                        baseUrl: cp.base_url || '',
                        isCustom: true,
                      })
                    }
                    isActive={editingCustomProviderId === cp.id}
                  >
                    <ProviderLogo providerType={cp.provider_type} name={cp.name} />
                    <span className="truncate">{cp.name}</span>
                    <ProviderStatus count={modelCounts[cp.id] ?? 0} />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => onSelectProvider(CUSTOM_PROVIDER)}
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
  )
}

/** Setup truth for a configured provider row: count when usable, warning
 * when saved without models (the state that blocked the composer). */
function ProviderStatus({ count }: { count: number }) {
  const { t } = useTranslation('providers')

  if (count === 0) {
    return (
      <span className="ml-auto" title={t('needsModels')}>
        <AlertTriangle className="size-3 text-warning" />
        <span className="sr-only">{t('needsModels')}</span>
      </span>
    )
  }

  return (
    <span className="ml-auto text-2xs text-muted-foreground" title={t('modelCount', { count })}>
      {count}
    </span>
  )
}
