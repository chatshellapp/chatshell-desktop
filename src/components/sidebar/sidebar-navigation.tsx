import { SquarePen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

const NEW_CONVERSATION_SHORTCUT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘N' : 'Ctrl+N'

export interface NavItem {
  id: string
  title: string
  url: string
  icon: React.ComponentType<{ className?: string }>
  isActive: boolean
}

interface SidebarNavigationProps {
  navItems: NavItem[]
  activeItem: NavItem
  onItemClick: (item: NavItem) => void
  onSettingsClick: () => void
  onNewConversation: () => void
  user: { name: string; email: string; avatar: string }
}

export function SidebarNavigation({
  navItems,
  activeItem,
  onItemClick,
  onSettingsClick,
  onNewConversation,
}: SidebarNavigationProps) {
  const { t } = useTranslation()
  const settingsItem = navItems.find((item) => item.id === 'settings')
  const mainItems = navItems.filter((item) => item.id !== 'settings')

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.id}>
      <SidebarMenuButton
        tooltip={{
          children: item.title,
          hidden: false,
        }}
        onClick={() => {
          if (item.id === 'settings') {
            onSettingsClick()
          } else {
            onItemClick(item)
          }
        }}
        isActive={activeItem?.id === item.id}
        className="px-2.5 md:px-2"
      >
        <item.icon />
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )

  return (
    <Sidebar collapsible="none" className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r">
      <SidebarHeader className="px-1.5 pb-0 md:px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={{
                children: `${t('sidebar:newConversation')} (${NEW_CONVERSATION_SHORTCUT})`,
                hidden: false,
              }}
              onClick={onNewConversation}
              aria-label={t('sidebar:newConversation')}
              className="px-2.5 md:px-2"
            >
              <SquarePen />
              <span>{t('sidebar:newConversation')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="px-1.5 md:px-0">
            <SidebarMenu>{mainItems.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {settingsItem && (
        <SidebarFooter className="px-1.5 md:px-2">
          <SidebarMenu>{renderItem(settingsItem)}</SidebarMenu>
        </SidebarFooter>
      )}
    </Sidebar>
  )
}
