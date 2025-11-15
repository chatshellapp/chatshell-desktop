import { AppSidebar } from "@/components/app-sidebar"
import { ChatView } from "@/components/chat-view"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useTopicStore } from "@/stores/topicStore"
import { useAppInit } from "@/hooks/useAppInit"
import { SimpleSettingsDialog } from "@/components/simple-settings-dialog"

export function ChatPage() {
  // Initialize app (load agents, topics, settings)
  const { isInitialized, error: initError } = useAppInit()

  const currentTopic = useTopicStore((state) => state.currentTopic)

  // Show loading screen while initializing
  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-lg">Loading ChatShell...</p>
        </div>
      </div>
    )
  }

  // Show error if initialization failed
  if (initError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-lg text-red-500">Failed to initialize app</p>
          <p className="text-sm text-muted-foreground">{initError}</p>
        </div>
      </div>
    )
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "350px",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset className="flex flex-col relative">
        <header className="bg-background sticky top-0 flex shrink-0 items-center gap-2 border-b p-4 z-10">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="#">Conversations</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {currentTopic?.title || "Select a conversation"}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto">
            <SimpleSettingsDialog />
          </div>
        </header>
        <ChatView />
      </SidebarInset>
    </SidebarProvider>
  )
}

