'use client'

import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
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
  const customStoreProviders = storeProviders.filter((p) => isCustomProviderType(p.provider_type))

  return (
    <Sidebar collapsible="none" className="hidden md:flex">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {BUILTIN_PROVIDERS.map((provider) => {
                const hasExisting = storeProviders.some((p) => p.provider_type === provider.id)
                return (
                  <SidebarMenuItem key={provider.id}>
                    <SidebarMenuButton
                      onClick={() => onSelectProvider(provider)}
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
                    <span className="ml-auto text-xs text-muted-foreground">●</span>
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
