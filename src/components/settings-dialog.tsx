'use client'

import * as React from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  // Globe,
  Heading,
  // Home,
  // Keyboard,
  // Link,
  // Lock,
  // Menu,
  // MessageCircle,
  // Paintbrush,
  Search,
  // Settings,
  // Video,
} from 'lucide-react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { useModelStore } from '@/stores/modelStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { SearchProviderId, WebFetchMode, WebFetchLocalMethod, LogLevel } from '@/types'
import { LLMProviderSettings } from '@/components/settings-dialog/llm-provider-settings'
import { logger } from '@/lib/logger'

const data = {
  nav: [
    { name: 'LLM Provider', icon: Bot },
    { name: 'Conversation Title', icon: Heading },
    { name: 'Web Fetch', icon: FileDown },
    { name: 'Web Search', icon: Search },
    { name: 'Logging', icon: FileText },
    // { name: 'Navigation', icon: Menu },
    // { name: 'Home', icon: Home },
    // { name: 'Appearance', icon: Paintbrush },
    // { name: 'Messages & media', icon: MessageCircle },
    // { name: 'Language & region', icon: Globe },
    // { name: 'Accessibility', icon: Keyboard },
    // { name: 'Mark as read', icon: Check },
    // { name: 'Audio & video', icon: Video },
    // { name: 'Connected accounts', icon: Link },
    // { name: 'Privacy & visibility', icon: Lock },
    // { name: 'Advanced', icon: Settings },
  ],
}

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeSection, setActiveSection] = React.useState('LLM Provider')
  const [summaryModelId, setSummaryModelId] = React.useState('')
  const [searchProviderId, setSearchProviderId] = React.useState<SearchProviderId>('duckduckgo')

  // Web Fetch state
  const [webFetchMode, setWebFetchMode] = React.useState<WebFetchMode>('local')
  const [webFetchLocalMethod, setWebFetchLocalMethod] = React.useState<WebFetchLocalMethod>('auto')
  const [jinaApiKey, setJinaApiKey] = React.useState('')
  const [showJinaApiKey, setShowJinaApiKey] = React.useState(false)

  // Logging state
  const [logLevelRust, setLogLevelRustState] = React.useState<LogLevel>('info')
  const [logLevelTypeScript, setLogLevelTypeScriptState] = React.useState<LogLevel>('info')

  const saveSetting = useSettingsStore((state) => state.saveSetting)
  const getSetting = useSettingsStore((state) => state.getSetting)
  const searchProviders = useSettingsStore((state) => state.searchProviders)
  const loadSearchProviders = useSettingsStore((state) => state.loadSearchProviders)
  const setSearchProvider = useSettingsStore((state) => state.setSearchProvider)
  const models = useModelStore((state) => state.models)
  const loadModels = useModelStore((state) => state.loadModels)
  const getModelById = useModelStore((state) => state.getModelById)

  // Web Fetch store methods
  const getWebFetchMode = useSettingsStore((state) => state.getWebFetchMode)
  const saveWebFetchMode = useSettingsStore((state) => state.setWebFetchMode)
  const getWebFetchLocalMethod = useSettingsStore((state) => state.getWebFetchLocalMethod)
  const saveWebFetchLocalMethod = useSettingsStore((state) => state.setWebFetchLocalMethod)
  const getJinaApiKey = useSettingsStore((state) => state.getJinaApiKey)
  const saveJinaApiKey = useSettingsStore((state) => state.setJinaApiKey)

  // Logging store methods
  const getLogLevelRust = useSettingsStore((state) => state.getLogLevelRust)
  const saveLogLevelRust = useSettingsStore((state) => state.setLogLevelRust)
  const getLogLevelTypeScript = useSettingsStore((state) => state.getLogLevelTypeScript)
  const saveLogLevelTypeScript = useSettingsStore((state) => state.setLogLevelTypeScript)

  // Load models and settings when dialog opens
  React.useEffect(() => {
    if (open) {
      loadModels()
      loadSearchProviders()
      const loadSettings = async () => {
        const summaryModelValue = await getSetting('conversation_summary_model_id')
        if (summaryModelValue) setSummaryModelId(summaryModelValue)

        const searchProviderValue = await getSetting('search_provider')
        if (searchProviderValue) {
          setSearchProviderId(searchProviderValue as SearchProviderId)
        }

        // Load web fetch settings
        const fetchMode = await getWebFetchMode()
        setWebFetchMode(fetchMode)

        const localMethod = await getWebFetchLocalMethod()
        setWebFetchLocalMethod(localMethod)

        const jinaKey = await getJinaApiKey()
        if (jinaKey) setJinaApiKey(jinaKey)

        // Load logging settings
        const rustLogLevel = await getLogLevelRust()
        setLogLevelRustState(rustLogLevel)

        const tsLogLevel = await getLogLevelTypeScript()
        setLogLevelTypeScriptState(tsLogLevel)
      }
      loadSettings()
    }
  }, [
    open,
    loadModels,
    loadSearchProviders,
    getSetting,
    getWebFetchMode,
    getWebFetchLocalMethod,
    getJinaApiKey,
    getLogLevelRust,
    getLogLevelTypeScript,
  ])

  const handleSaveSummaryModel = async (modelId: string) => {
    setSummaryModelId(modelId)
    try {
      await saveSetting('conversation_summary_model_id', modelId)
    } catch (error) {
      logger.error('Failed to save summary model setting:', error)
    }
  }

  const handleSaveSearchProvider = async (providerId: SearchProviderId) => {
    setSearchProviderId(providerId)
    try {
      await setSearchProvider(providerId)
    } catch (error) {
      logger.error('Failed to save search provider setting:', error)
    }
  }

  // Web Fetch handlers
  const handleSaveWebFetchMode = async (mode: WebFetchMode) => {
    setWebFetchMode(mode)
    try {
      await saveWebFetchMode(mode)
    } catch (error) {
      logger.error('Failed to save web fetch mode:', error)
    }
  }

  const handleSaveWebFetchLocalMethod = async (method: WebFetchLocalMethod) => {
    setWebFetchLocalMethod(method)
    try {
      await saveWebFetchLocalMethod(method)
    } catch (error) {
      logger.error('Failed to save web fetch local method:', error)
    }
  }

  const handleSaveJinaApiKey = async () => {
    try {
      await saveJinaApiKey(jinaApiKey)
    } catch (error) {
      logger.error('Failed to save Jina API key:', error)
    }
  }

  // Logging handlers
  const handleSaveLogLevelRust = async (level: LogLevel) => {
    setLogLevelRustState(level)
    try {
      await saveLogLevelRust(level)
    } catch (error) {
      logger.error('Failed to save Rust log level:', error)
    }
  }

  const handleSaveLogLevelTypeScript = async (level: LogLevel) => {
    setLogLevelTypeScriptState(level)
    try {
      await saveLogLevelTypeScript(level)
    } catch (error) {
      logger.error('Failed to save TypeScript log level:', error)
    }
  }

  const selectedModel = summaryModelId ? getModelById(summaryModelId) : null
  const selectedSearchProvider = searchProviders.find((p) => p.id === searchProviderId)

  const renderContent = () => {
    if (activeSection === 'LLM Provider') {
      return <LLMProviderSettings open={open} />
    }

    if (activeSection === 'Conversation Title') {
      return (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="summary-model">Conversation Title Model</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full max-w-md justify-between">
                  <span className="truncate">
                    {selectedModel ? selectedModel.name : 'Use current conversation model'}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[400px] max-h-[300px] overflow-y-auto">
                <DropdownMenuItem onClick={() => handleSaveSummaryModel('')}>
                  <span>Use current conversation model (default)</span>
                </DropdownMenuItem>
                {models.map((model) => (
                  <DropdownMenuItem key={model.id} onClick={() => handleSaveSummaryModel(model.id)}>
                    <span className="truncate">{model.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground max-w-md">
              Choose a model for generating conversation titles. Defaults to the current
              conversation model if not set.
            </p>
          </div>
        </div>
      )
    }

    if (activeSection === 'Web Fetch') {
      return (
        <div className="grid gap-6">
          {/* Mode Selection */}
          <div className="grid gap-2">
            <Label>Fetch Mode</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full max-w-md justify-between">
                  <span>{webFetchMode === 'local' ? 'Local' : 'API'}</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[400px]">
                <DropdownMenuItem onClick={() => handleSaveWebFetchMode('local')}>
                  <div className="flex items-center gap-2">
                    {webFetchMode === 'local' && <Check className="h-4 w-4 text-primary" />}
                    <span className={webFetchMode === 'local' ? 'font-medium' : ''}>Local</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSaveWebFetchMode('api')}>
                  <div className="flex items-center gap-2">
                    {webFetchMode === 'api' && <Check className="h-4 w-4 text-primary" />}
                    <span className={webFetchMode === 'api' ? 'font-medium' : ''}>API</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground max-w-md">
              Choose whether to fetch web pages locally or via an API service.
            </p>
          </div>

          {/* Fetch Strategy Selection */}
          {webFetchMode === 'local' && (
            <div className="grid gap-2">
              <Label>Fetch Strategy</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full max-w-md justify-between">
                    <span>
                      {webFetchLocalMethod === 'auto' && 'Auto'}
                      {webFetchLocalMethod === 'fetch' && 'Always use Fetch'}
                      {webFetchLocalMethod === 'headless' && 'Always use Headless Chrome'}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[400px]">
                  <DropdownMenuItem onClick={() => handleSaveWebFetchLocalMethod('auto')}>
                    <div className="flex items-center gap-2">
                      {webFetchLocalMethod === 'auto' && <Check className="h-4 w-4 text-primary" />}
                      <div>
                        <span className={webFetchLocalMethod === 'auto' ? 'font-medium' : ''}>
                          Auto
                        </span>
                        <p className="text-xs text-muted-foreground">
                          Try HTTP first, fallback to headless Chrome
                        </p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSaveWebFetchLocalMethod('fetch')}>
                    <div className="flex items-center gap-2">
                      {webFetchLocalMethod === 'fetch' && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                      <div>
                        <span className={webFetchLocalMethod === 'fetch' ? 'font-medium' : ''}>
                          Always use Fetch
                        </span>
                        <p className="text-xs text-muted-foreground">
                          Faster but may fail on protected sites
                        </p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSaveWebFetchLocalMethod('headless')}>
                    <div className="flex items-center gap-2">
                      {webFetchLocalMethod === 'headless' && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                      <div>
                        <span className={webFetchLocalMethod === 'headless' ? 'font-medium' : ''}>
                          Always use Headless Chrome
                        </span>
                        <p className="text-xs text-muted-foreground">
                          Slower but handles JavaScript-rendered content
                        </p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* API Provider Selection */}
          {webFetchMode === 'api' && (
            <>
              <div className="grid gap-2">
                <Label>API Provider</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full max-w-md justify-between">
                      <span>Jina Reader</span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[400px]">
                    <DropdownMenuItem>
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        <div>
                          <span className="font-medium">Jina Reader</span>
                          <p className="text-xs text-muted-foreground">https://r.jina.ai/</p>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="jina-api-key">Jina API Key (Optional)</Label>
                <div className="relative max-w-md">
                  <Input
                    id="jina-api-key"
                    type={showJinaApiKey ? 'text' : 'password'}
                    placeholder="Enter your Jina API key for higher rate limits"
                    value={jinaApiKey}
                    onChange={(e) => setJinaApiKey(e.target.value)}
                    onBlur={handleSaveJinaApiKey}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowJinaApiKey(!showJinaApiKey)}
                  >
                    {showJinaApiKey ? (
                      <EyeOff className="size-4 text-muted-foreground" />
                    ) : (
                      <Eye className="size-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground max-w-md">
                  Jina Reader works without an API key, but providing one gives higher rate limits.
                </p>
              </div>
            </>
          )}
        </div>
      )
    }

    if (activeSection === 'Web Search') {
      return (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <Label htmlFor="search-provider">Search Engine</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full max-w-md justify-between">
                  <span className="truncate">{selectedSearchProvider?.name || 'DuckDuckGo'}</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[400px]">
                {searchProviders.map((provider) => (
                  <DropdownMenuItem
                    key={provider.id}
                    onClick={() => handleSaveSearchProvider(provider.id as SearchProviderId)}
                  >
                    <div className="flex items-center gap-2">
                      {provider.id === searchProviderId && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                      <span className={provider.id === searchProviderId ? 'font-medium' : ''}>
                        {provider.name}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground max-w-md">
              Choose the search engine to use when web search is enabled. Different search engines
              may provide different results for the same query.
            </p>
          </div>
        </div>
      )
    }

    if (activeSection === 'Logging') {
      const logLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error']
      const logLevelDescriptions: Record<LogLevel, string> = {
        trace: 'Most verbose - all logs including detailed traces',
        debug: 'Debug information for troubleshooting',
        info: 'General informational messages (recommended)',
        warn: 'Warning messages only',
        error: 'Error messages only',
      }

      return (
        <div className="grid gap-6">
          {/* Rust Log Level */}
          <div className="grid gap-2">
            <Label>Backend (Rust) Log Level</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full max-w-md justify-between">
                  <span className="capitalize">{logLevelRust}</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[400px]">
                {logLevels.map((level) => (
                  <DropdownMenuItem key={level} onClick={() => handleSaveLogLevelRust(level)}>
                    <div className="flex items-center gap-2">
                      {level === logLevelRust && <Check className="h-4 w-4 text-primary" />}
                      <div>
                        <span
                          className={
                            level === logLevelRust ? 'font-medium capitalize' : 'capitalize'
                          }
                        >
                          {level}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {logLevelDescriptions[level]}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground max-w-md">
              Controls the verbosity of backend logs written to disk.
            </p>
          </div>

          {/* TypeScript Log Level */}
          <div className="grid gap-2">
            <Label>Frontend (TypeScript) Log Level</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full max-w-md justify-between">
                  <span className="capitalize">{logLevelTypeScript}</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[400px]">
                {logLevels.map((level) => (
                  <DropdownMenuItem key={level} onClick={() => handleSaveLogLevelTypeScript(level)}>
                    <div className="flex items-center gap-2">
                      {level === logLevelTypeScript && <Check className="h-4 w-4 text-primary" />}
                      <div>
                        <span
                          className={
                            level === logLevelTypeScript ? 'font-medium capitalize' : 'capitalize'
                          }
                        >
                          {level}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {logLevelDescriptions[level]}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground max-w-md">
              Controls the verbosity of frontend logs written to disk.
            </p>
          </div>

          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground max-w-md">
              Log files are stored in the application data directory under the{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">logs/</code> folder. Both
              frontend and backend logs are written to separate files and rotated daily.
            </p>
          </div>
        </div>
      )
    }

    // Placeholder content for other sections
    return (
      <>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="bg-muted/50 aspect-video max-w-3xl rounded-xl" />
        ))}
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 md:max-h-[600px] md:max-w-[700px] lg:max-w-[900px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Customize your settings here.</DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {data.nav.map((item) => (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          isActive={item.name === activeSection}
                          onClick={() => setActiveSection(item.name)}
                        >
                          <item.icon />
                          <span>{item.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[600px] flex-1 flex-col overflow-hidden">
            <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2 px-4">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink href="#">Settings</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{activeSection}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div
              className={`flex flex-1 flex-col overflow-hidden ${activeSection === 'LLM Provider' ? '' : 'gap-4 overflow-y-auto p-4 pt-0'}`}
            >
              {renderContent()}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
