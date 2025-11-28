import { Command, MessageSquarePlus } from "lucide-react"
import { NavUser } from "@/components/nav-user"
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
  useSidebar,
} from "@/components/ui/sidebar"

export interface NavItem {
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
  user,
}: SidebarNavigationProps) {
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"

  return (
    <Sidebar
      collapsible="none"
      className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r"
    >
      {/* <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="md:h-8 md:p-0">
              <a href="#">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Command className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Acme Inc</span>
                  <span className="truncate text-xs">Enterprise</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader> */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="px-1.5 md:px-0">
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={{
                      children: item.title,
                      hidden: false,
                    }}
                    onClick={() => {
                      if (item.title === "Settings") {
                        onSettingsClick()
                      } else {
                        onItemClick(item)
                      }
                    }}
                    isActive={activeItem?.title === item.title}
                    className="px-2.5 md:px-2"
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-2">
        {isCollapsed && (
          <button
            onClick={onNewConversation}
            className="mx-auto flex size-8 items-center justify-center rounded-full bg-black text-white hover:bg-black/80 transition-colors"
            title="New Conversation"
          >
            <MessageSquarePlus className="size-4" />
          </button>
        )}
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}

