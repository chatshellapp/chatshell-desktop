'use client'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import type { Provider } from '@/types'
import type { LLMProvider } from './types'
import { llmProviders } from './constants'

interface ProviderSidebarProps {
  selectedProvider: LLMProvider
  onSelectProvider: (provider: LLMProvider) => void
  storeProviders: Provider[]
}

export function ProviderSidebar({
  selectedProvider,
  onSelectProvider,
  storeProviders,
}: ProviderSidebarProps) {
  return (
    <Sidebar collapsible="none" className="hidden md:flex">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {llmProviders.map((provider) => {
                const hasExisting = storeProviders.some((p) => p.provider_type === provider.id)
                return (
                  <SidebarMenuItem key={provider.id}>
                    <SidebarMenuButton
                      onClick={() => onSelectProvider(provider)}
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
  )
}
