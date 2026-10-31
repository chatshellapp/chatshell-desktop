import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, X } from 'lucide-react'
import { MorphSpinner } from '@/components/ui/morph-spinner'
import { AppSidebar } from '@/components/app-sidebar'
import { ChatView } from '@/components/chat-view'
import { TranslationContent } from '@/components/sidebar/translation-content'
import { SearchDialog } from '@/components/search/search-dialog'
import { useSearchStore } from '@/stores/searchStore'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { useConversationStore } from '@/stores/conversation'
import { useAppInit } from '@/hooks/useAppInit'
import { OnboardingDialog } from '@/components/onboarding-dialog'
import { SyncOnboardingDialog } from '@/components/sync/sync-onboarding-dialog'
import { SyncLockedBanner } from '@/components/sync/sync-locked-banner'
import { useSyncSetupStore } from '@/stores/syncSetupStore'
import { toast } from 'sonner'
import { useUpdaterStore } from '@/stores/updaterStore'

export function ChatPage() {
  const { t } = useTranslation()
  const [activeSection, setActiveSection] = useState('conversations')
  const isTranslation = activeSection === 'translation'
  // Initialize app (load agents, conversations, settings)
  const { isInitialized, error: initError, keychainAvailable } = useAppInit()
  const [showKeychainWarning, setShowKeychainWarning] = useState(true)

  // Sync enablement state (ADR 04): drives the onboarding card and the
  // history-locked banner.
  const loadSyncSetup = useSyncSetupStore((state) => state.load)
  useEffect(() => {
    loadSyncSetup()
  }, [loadSyncSetup])

  // Updater: deferred silent check shortly after startup (dev builds skip it).
  const runStartupUpdateCheck = useUpdaterStore((s) => s.runStartupCheck)
  useEffect(() => {
    if (import.meta.env.DEV) return
    const timer = setTimeout(() => void runStartupUpdateCheck(), 5000)
    return () => clearTimeout(timer)
  }, [runStartupUpdateCheck])

  // Surface background-found updates and finished downloads as toasts with
  // one-click actions; the full flow also lives in Settings > About.
  const { t: ts } = useTranslation('settings')
  const updaterUpdate = useUpdaterStore((s) => s.update)
  const updaterDownloadReady = useUpdaterStore((s) => s.status === 'ready')
  useEffect(() => {
    if (!updaterUpdate) return
    toast(ts('updateAvailableToast', { version: updaterUpdate.version }), {
      duration: 10000,
      action: {
        label: ts('updateDownloadButton'),
        onClick: () => void useUpdaterStore.getState().downloadUpdate(),
      },
    })
  }, [updaterUpdate, ts])
  useEffect(() => {
    if (!updaterDownloadReady) return
    toast(ts('updateReadyToast'), {
      duration: 10000,
      action: {
        label: ts('updateReadyButton'),
        onClick: () => void useUpdaterStore.getState().installAndRestart(),
      },
    })
  }, [updaterDownloadReady, ts])

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

  // Global shortcut: Cmd+K / Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        useSearchStore.getState().toggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const currentConversation = useConversationStore((state) => state.currentConversation)

  // Search and translation continuation can select a conversation outside the sidebar.
  useEffect(() => {
    return useConversationStore.subscribe((state, previous) => {
      if (state.currentConversation?.id !== previous.currentConversation?.id) {
        setActiveSection((section) => (section === 'translation' ? 'conversations' : section))
      }
    })
  }, [])

  // Show loading screen while initializing
  if (!isInitialized) {
    return (
      <div className="relative h-screen">
        {/* Spinner pinned at the exact viewport center, matching the
            index.html splash — the "loading" text appears below it without
            shifting the spinner, so the splash handoff never jitters. */}
        <div className="absolute inset-0 flex items-center justify-center">
          <MorphSpinner size={16} />
        </div>
        <p className="absolute inset-x-0 top-1/2 mt-5 text-center text-sm text-muted-foreground">
          {t('common:loading')}
        </p>
      </div>
    )
  }

  // Show error if initialization failed
  if (initError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-lg text-destructive">{t('common:failedToInitialize')}</p>
          <p className="text-sm text-muted-foreground">{initError}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <SidebarProvider
        defaultOpen={false}
        style={
          {
            '--sidebar-width': '350px',
          } as React.CSSProperties
        }
      >
        <AppSidebar activeSection={activeSection} onSectionChange={setActiveSection} />
        <SidebarInset className="flex min-w-0 flex-col h-screen overflow-hidden">
          <header
            className={
              isTranslation
                ? 'flex shrink-0 items-center gap-2 border-b px-4 py-3 md:hidden'
                : 'bg-background flex shrink-0 items-center gap-2 border-b p-4'
            }
          >
            <SidebarTrigger className={isTranslation ? '-ml-1 md:hidden' : '-ml-1'} />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <h1 className="min-w-0 truncate text-sm font-medium">
              {isTranslation
                ? t('sidebar:translation')
                : currentConversation
                  ? currentConversation.title || t('sidebar:newConversation')
                  : t('chat:selectConversation')}
            </h1>
          </header>
          <SyncLockedBanner />
          {!keychainAvailable && showKeychainWarning && (
            <div className="flex items-center justify-between gap-2 bg-warning/10 border-b border-warning/20 px-4 py-2 text-sm text-warning">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{t('common:keychainWarning')}</span>
              </div>
              <button
                onClick={() => setShowKeychainWarning(false)}
                className="p-1 hover:bg-warning/15 rounded transition-colors"
                aria-label="Dismiss warning"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {isTranslation ? <TranslationContent /> : <ChatView />}
        </SidebarInset>
      </SidebarProvider>
      <Toaster position="top-center" />
      <OnboardingDialog />
      <SyncOnboardingDialog />
      <SearchDialog />
    </>
  )
}
