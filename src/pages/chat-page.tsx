import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { AppSidebar } from '@/components/app-sidebar'
import { ChatView } from '@/components/chat-view'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { useConversationStore } from '@/stores/conversation'
import { useAppInit } from '@/hooks/useAppInit'
import { OnboardingDialog } from '@/components/onboarding-dialog'

export function ChatPage() {
  // Initialize app (load agents, conversations, settings)
  const { isInitialized, error: initError, keychainAvailable } = useAppInit()
  const [showKeychainWarning, setShowKeychainWarning] = useState(true)

  // Prevent default browser drag-drop behavior (which opens files)
  // This allows only the chat-input component to handle file drops
  useEffect(() => {
    const preventDefaultDrag = (e: DragEvent) => {
      e.preventDefault()
    }

    document.addEventListener('dragover', preventDefaultDrag)
    document.addEventListener('drop', preventDefaultDrag)

    return () => {
      document.removeEventListener('dragover', preventDefaultDrag)
      document.removeEventListener('drop', preventDefaultDrag)
    }
  }, [])

  const currentConversation = useConversationStore((state) => state.currentConversation)

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
    <>
      <SidebarProvider
        style={
          {
            '--sidebar-width': '350px',
          } as React.CSSProperties
        }
      >
        <AppSidebar />
        <SidebarInset className="flex flex-col h-screen overflow-hidden">
          <header className="bg-background flex shrink-0 items-center gap-2 border-b p-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#">Conversations</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>
                    {currentConversation?.title || 'Select a conversation'}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </header>
          {!keychainAvailable && showKeychainWarning && (
            <div className="flex items-center justify-between gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Keychain access denied. API keys are stored temporarily and will need to be
                  re-entered after restarting the app.
                </span>
              </div>
              <button
                onClick={() => setShowKeychainWarning(false)}
                className="p-1 hover:bg-amber-500/20 rounded transition-colors"
                aria-label="Dismiss warning"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <ChatView />
        </SidebarInset>
      </SidebarProvider>
      <Toaster position="top-center" />
      <OnboardingDialog />
    </>
  )
}
