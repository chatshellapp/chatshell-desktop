'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Bug,
  Check,
  Cloud,
  ChevronDown,
  Eye,
  EyeOff,
  FileDown,
  Globe,
  Heart,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  Star,
  Settings,
  Stethoscope,
  Trash2,
  Wrench,
  Zap,
  FolderOpen,
  ToggleLeft,
  ToggleRight,
  LogIn,
} from 'lucide-react'

import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
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
import { useConversationStore } from '@/stores/conversation'
import { useMcpStore } from '@/stores/mcpStore'
import { useModelStore } from '@/stores/modelStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSkillStore } from '@/stores/skillStore'
import type {
  Model,
  Provider,
  SearchProviderId,
  CapabilitiesCacheInfo,
  WebFetchMode,
  WebFetchLocalMethod,
  LogLevel,
  Tool,
  Skill,
  SkillSource,
} from '@/types'
import {
  parseMcpConfig,
  getTransportType,
  isBuiltinTool,
  sortBuiltinTools,
  isMcpTool,
  isBuiltinSkill,
  getSkillsBySource,
  SKILL_SOURCE_ORDER,
} from '@/types'
import { LLMProviderSettings } from '@/components/settings-dialog/llm-provider-settings'
import { ObscuraInstallHint } from '@/components/settings-dialog/obscura-install-hint'
import { fetchModelCapabilities, invalidateCapabilitiesCache } from '@/hooks/useModelCapabilities'
import { invalidateVisionFallbackStatus } from '@/hooks/useVisionFallbackStatus'
import { logger } from '@/lib/logger'
import appIcon from '@/assets/app-icon.png'
import { changeLanguage, supportedLanguages, getCurrentLanguage } from '@/lib/i18n'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BuiltinToolIcon } from '@/components/builtin-tool-icon'
import { SyncSettingsSection } from '@/components/sync/sync-settings-section'
import { McpServerConfigModal } from '@/components/mcp-server-config-modal'

// Translation key per fetch strategy. Record<> forces exhaustiveness: adding
// a WebFetchLocalMethod variant without a label here is a compile error.
const FETCH_METHOD_LABELS: Record<WebFetchLocalMethod, string> = {
  auto: 'auto',
  obscura: 'alwaysUseObscura',
  fetch: 'alwaysUseFetch',
  webview: 'alwaysUseWebview',
  headless: 'alwaysUseChrome',
}

// External destinations for the About section.
const GITHUB_REPO_URL = 'https://github.com/chatshellapp/chatshell-desktop'
const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`

const data = {
  nav: [
    { name: 'llmProvider', icon: Bot },
    { name: 'auxModels', icon: Sparkles },
    { name: 'builtInTools', icon: Wrench },
    { name: 'mcpServers', icon: Plug },
    { name: 'skills', icon: Zap },
    { name: 'webFetch', icon: FileDown },
    { name: 'webSearch', icon: Search },
    { name: 'sync', icon: Cloud },
    { name: 'language', icon: Globe },
    { name: 'advanced', icon: Settings },
    { name: 'about', icon: Heart },
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

interface LogStorageInfo {
  total_bytes: number
  file_count: number
}

// Dropdown list of confirmed vision-capable models. Capabilities resolve
// asynchronously against the backend cache; models that are not confirmed
// vision-capable (false or unknown) are filtered out. The default entry
// ("use current conversation model") remains available regardless.
function AuxVisionModelList({
  models,
  getProviderById,
  onSelect,
}: {
  models: Model[]
  getProviderById: (id: string) => Provider | undefined
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation('settings')
  const [visionModels, setVisionModels] = React.useState<Model[] | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const resolveVisionModels = async () => {
      const resolved = await Promise.all(
        models.map(async (model) => {
          const provider = getProviderById(model.provider_id)
          if (!provider) return null
          const capabilities = await fetchModelCapabilities(provider.provider_type, model.model_id)
          return capabilities.supports_vision === true ? model : null
        })
      )
      if (!cancelled) {
        setVisionModels(resolved.filter((model): model is Model => model !== null))
      }
    }
    resolveVisionModels()
    return () => {
      cancelled = true
    }
  }, [models, getProviderById])

  if (visionModels === null) {
    return (
      <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('checkingVisionModels')}</div>
    )
  }
  if (visionModels.length === 0) {
    return <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('noVisionModels')}</div>
  }
  return visionModels.map((model) => (
    <DropdownMenuItem key={model.id} onClick={() => onSelect(model.id)}>
      <span className="truncate">{model.name}</span>
    </DropdownMenuItem>
  ))
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const [activeSection, setActiveSection] = React.useState('llmProvider')
  const [auxTinyModelId, setAuxTinyModelId] = React.useState('')
  const [auxVisionModelId, setAuxVisionModelId] = React.useState('')
  const [searchProviderId, setSearchProviderId] = React.useState<SearchProviderId>('duckduckgo')

  // Web Fetch state
  const [webFetchMode, setWebFetchMode] = React.useState<WebFetchMode>('local')
  const [webFetchLocalMethod, setWebFetchLocalMethod] = React.useState<WebFetchLocalMethod>('auto')
  const [obscuraAvailable, setObscuraAvailable] = React.useState(false)
  const [chromeAvailable, setChromeAvailable] = React.useState(false)
  const [jinaApiKey, setJinaApiKey] = React.useState('')
  const [showJinaApiKey, setShowJinaApiKey] = React.useState(false)

  // Language state
  const [currentLanguage, setCurrentLanguage] = React.useState(getCurrentLanguage)

  // Logging state
  const [logLevelRust, setLogLevelRustState] = React.useState<LogLevel>('info')
  const [logLevelTypeScript, setLogLevelTypeScriptState] = React.useState<LogLevel>('info')
  const [logStorageInfo, setLogStorageInfo] = React.useState<LogStorageInfo | null>(null)
  const [logMaxTotalMb, setLogMaxTotalMbState] = React.useState<number>(50)
  const [logDiagnosing, setLogDiagnosing] = React.useState(false)
  // Skill search state
  const [skillSearchQuery, setSkillSearchQuery] = React.useState('')

  // About section state
  const [appVersion, setAppVersion] = React.useState<string | null>(null)

  const loadLogStorageInfo = React.useCallback(async () => {
    try {
      setLogStorageInfo(await invoke<LogStorageInfo>('get_log_storage_info'))
    } catch (error) {
      logger.error('Failed to load log storage info:', error)
    }
  }, [])

  const formatLogSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${bytes} B`
  }

  const handleSaveLogMaxTotalMb = async (mb: number) => {
    setLogMaxTotalMbState(mb)
    try {
      setLogStorageInfo(await invoke<LogStorageInfo>('set_log_max_total_mb', { maxTotalMb: mb }))
    } catch (error) {
      logger.error('Failed to save log size limit:', error)
      toast.error(t('logSizeLimitSaveFailed'))
    }
  }

  const handleOpenLogsDirectory = async () => {
    try {
      await invoke('open_logs_directory')
    } catch (error) {
      logger.error('Failed to open logs directory:', error)
      toast.error(String(error))
    }
  }

  const openExternal = async (url: string) => {
    try {
      await openUrl(url)
    } catch (error) {
      logger.error('Failed to open URL:', error)
      toast.error(String(error))
    }
  }

  const handleCopyRecommendation = async () => {
    try {
      await navigator.clipboard.writeText(t('aboutRecommendationText'))
      toast.success(t('aboutRecommendCopied'))
    } catch (error) {
      logger.error('Failed to copy recommendation:', error)
      toast.error(String(error))
    }
  }

  const handleDiagnoseLogs = async () => {
    setLogDiagnosing(true)
    try {
      const paths = await invoke<string[]>('get_today_log_paths')
      if (paths.length === 0) {
        toast.info(t('logDiagnosisEmpty'))
        return
      }
      const conversationStore = useConversationStore.getState()
      const conversation = await conversationStore.createConversation('')
      conversationStore.setPendingInput(t('logDiagnosisPrompt', { paths: paths.join('\n') }))
      await conversationStore.selectConversation(conversation.id)
      onOpenChange(false)
    } catch (error) {
      logger.error('Failed to start log diagnosis:', error)
      toast.error(t('logDiagnosisFailed'))
    } finally {
      setLogDiagnosing(false)
    }
  }

  // MCP state
  const [mcpConfigModalOpen, setMcpConfigModalOpen] = React.useState(false)
  const [editingMcpServer, setEditingMcpServer] = React.useState<Tool | null>(null)
  const [expandedToolsId, setExpandedToolsId] = React.useState<string | null>(null)
  const [oauthAuthorizingId, setOauthAuthorizingId] = React.useState<string | null>(null)
  const [capabilitiesRefreshing, setCapabilitiesRefreshing] = React.useState(false)
  const [capabilitiesInfo, setCapabilitiesInfo] = React.useState<CapabilitiesCacheInfo | null>(null)

  const loadCapabilitiesInfo = React.useCallback(async () => {
    try {
      setCapabilitiesInfo(await invoke<CapabilitiesCacheInfo>('get_capabilities_cache_info'))
    } catch (error) {
      logger.error('Failed to load capabilities cache info:', error)
    }
  }, [])

  React.useEffect(() => {
    loadCapabilitiesInfo()
  }, [loadCapabilitiesInfo])

  React.useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch((error) => logger.error('Failed to get app version:', error))
  }, [])

  const saveSetting = useSettingsStore((state) => state.saveSetting)
  const getSetting = useSettingsStore((state) => state.getSetting)
  const searchProviders = useSettingsStore((state) => state.searchProviders)
  const loadSearchProviders = useSettingsStore((state) => state.loadSearchProviders)
  const setSearchProvider = useSettingsStore((state) => state.setSearchProvider)
  const models = useModelStore((state) => state.models)
  const loadModels = useModelStore((state) => state.loadModels)
  const getModelById = useModelStore((state) => state.getModelById)
  const loadProviders = useModelStore((state) => state.loadProviders)
  const getProviderById = useModelStore((state) => state.getProviderById)

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

  // Skill store methods
  const skills = useSkillStore((state) => state.skills)
  const skillsLoading = useSkillStore((state) => state.isLoading)
  const scanSkills = useSkillStore((state) => state.scanSkills)
  const toggleSkill = useSkillStore((state) => state.toggleSkill)
  const setAllSkillsEnabled = useSkillStore((state) => state.setAllEnabled)
  const skillSources = useSkillStore((state) => state.sources)
  const loadSkillSources = useSkillStore((state) => state.loadSources)
  const setSkillSourceEnabled = useSkillStore((state) => state.setSourceEnabled)

  // MCP store methods
  const mcpServers = useMcpStore((state) => state.servers)
  const mcpLoading = useMcpStore((state) => state.isLoading)
  const ensureMcpLoaded = useMcpStore((state) => state.ensureLoaded)
  const deleteMcpServer = useMcpStore((state) => state.deleteServer)
  const toggleMcpServer = useMcpStore((state) => state.toggleServer)
  const setAllToolsEnabled = useMcpStore((state) => state.setAllEnabled)
  const startOAuth = useMcpStore((state) => state.startOAuth)
  const loadMcpServers = useMcpStore((state) => state.loadServers)
  const connectServer = useMcpStore((state) => state.connectServer)
  const connectionStatus = useMcpStore((state) => state.connectionStatus)
  const serverTools = useMcpStore((state) => state.serverTools)
  const connectionErrors = useMcpStore((state) => state.connectionErrors)
  const probeResults = useMcpStore((state) => state.probeResults)

  // Load models and settings when dialog opens
  React.useEffect(() => {
    if (open) {
      loadProviders()
      loadModels()
      loadSearchProviders()
      ensureMcpLoaded()
      scanSkills()
      loadSkillSources()
      const loadSettings = async () => {
        const auxTinyValue = await getSetting('aux_tiny_model_id')
        if (auxTinyValue) setAuxTinyModelId(auxTinyValue)
        const auxVisionValue = await getSetting('aux_vision_model_id')
        if (auxVisionValue) setAuxVisionModelId(auxVisionValue)

        const searchProviderValue = await getSetting('search_provider')
        if (searchProviderValue) {
          setSearchProviderId(searchProviderValue as SearchProviderId)
        }

        // Load web fetch settings
        const fetchMode = await getWebFetchMode()
        setWebFetchMode(fetchMode)

        const localMethod = await getWebFetchLocalMethod()
        setWebFetchLocalMethod(localMethod)

        setObscuraAvailable(await invoke<boolean>('is_obscura_available'))
        setChromeAvailable(await invoke<boolean>('is_chrome_available'))

        const jinaKey = await getJinaApiKey()
        if (jinaKey) setJinaApiKey(jinaKey)

        // Load logging settings
        const rustLogLevel = await getLogLevelRust()
        setLogLevelRustState(rustLogLevel)

        const tsLogLevel = await getLogLevelTypeScript()
        setLogLevelTypeScriptState(tsLogLevel)

        // Log storage management
        const logMaxMb = await getSetting('log_max_total_mb')
        setLogMaxTotalMbState(logMaxMb ? Number(logMaxMb) : 50)
        await loadLogStorageInfo()
      }
      loadSettings()
    }
  }, [
    open,
    loadModels,
    loadProviders,
    loadSearchProviders,
    ensureMcpLoaded,
    scanSkills,
    getSetting,
    getWebFetchMode,
    getWebFetchLocalMethod,
    getJinaApiKey,
    getLogLevelRust,
    getLogLevelTypeScript,
    loadLogStorageInfo,
  ])

  const handleSaveAuxTinyModel = async (modelId: string) => {
    setAuxTinyModelId(modelId)
    try {
      await saveSetting('aux_tiny_model_id', modelId)
    } catch (error) {
      logger.error('Failed to save auxiliary tiny model setting:', error)
    }
  }

  const handleSaveAuxVisionModel = async (modelId: string) => {
    setAuxVisionModelId(modelId)
    try {
      await saveSetting('aux_vision_model_id', modelId)
      // The input-box image gate depends on the resolved fallback
      invalidateVisionFallbackStatus()
    } catch (error) {
      logger.error('Failed to save auxiliary vision model setting:', error)
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

  // MCP handlers
  const handleDeleteMcpServer = async (id: string) => {
    try {
      await deleteMcpServer(id)
    } catch (error) {
      logger.error('Failed to delete MCP server:', error)
    }
  }

  const handleToggleMcpServer = async (id: string) => {
    try {
      await toggleMcpServer(id)
    } catch (error) {
      logger.error('Failed to toggle MCP server:', error)
    }
  }

  const handleEditMcpServer = (server: Tool) => {
    setEditingMcpServer(server)
    setMcpConfigModalOpen(true)
  }

  const handleAddMcpServer = () => {
    setEditingMcpServer(null)
    setMcpConfigModalOpen(true)
  }

  const handleOAuthConnect = async (serverId: string) => {
    setOauthAuthorizingId(serverId)
    try {
      await startOAuth(serverId)
      await loadMcpServers()
      // Explicitly reconnect after OAuth to clear needs_auth status
      connectServer(serverId)
    } catch (e) {
      logger.error('OAuth connect failed', e)
    } finally {
      setOauthAuthorizingId(null)
    }
  }

  const selectedTinyModel = auxTinyModelId ? getModelById(auxTinyModelId) : undefined
  const selectedVisionModel = auxVisionModelId ? getModelById(auxVisionModelId) : undefined
  const selectedSearchProvider = searchProviders.find((p) => p.id === searchProviderId)

  // Separate builtin tools and MCP servers
  const builtinTools = sortBuiltinTools(mcpServers.filter((s) => isBuiltinTool(s)))
  const mcpServersOnly = mcpServers.filter((s) => isMcpTool(s))

  const handleToggleSkill = async (id: string) => {
    try {
      await toggleSkill(id)
    } catch (error) {
      logger.error('Failed to toggle skill:', error)
    }
  }

  const renderContent = () => {
    if (activeSection === 'llmProvider') {
      return <LLMProviderSettings open={open} />
    }

    if (activeSection === 'builtInTools') {
      const allBuiltinEnabled = builtinTools.length > 0 && builtinTools.every((t) => t.is_enabled)
      const allBuiltinDisabled = builtinTools.length > 0 && builtinTools.every((t) => !t.is_enabled)

      return (
        <div className="grid gap-6">
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{t('builtinToolsDescription')}</p>
            {builtinTools.length > 0 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAllToolsEnabled('builtin', true)}
                  disabled={allBuiltinEnabled}
                >
                  <ToggleRight className="mr-2 h-4 w-4" />
                  {t('enableAll')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAllToolsEnabled('builtin', false)}
                  disabled={allBuiltinDisabled}
                >
                  <ToggleLeft className="mr-2 h-4 w-4" />
                  {t('disableAll')}
                </Button>
              </div>
            )}
          </div>

          {builtinTools.length > 0 ? (
            <div className="grid gap-4 max-w-lg">
              {builtinTools.map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-start justify-between gap-4 rounded-lg border p-4"
                >
                  <div className="flex items-start gap-3">
                    <BuiltinToolIcon
                      toolId={tool.id}
                      className="h-5 w-5 text-muted-foreground mt-0.5"
                    />
                    <div className="grid gap-1">
                      <span className="font-medium">{tool.name}</span>
                      {tool.description && (
                        <p className="text-xs text-muted-foreground">{tool.description}</p>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={tool.is_enabled}
                    onCheckedChange={() => handleToggleMcpServer(tool.id)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {mcpLoading ? t('loadingBuiltInTools') : t('noBuiltInToolsAvailable')}
            </div>
          )}
        </div>
      )
    }

    if (activeSection === 'mcpServers') {
      const allMcpEnabled = mcpServersOnly.length > 0 && mcpServersOnly.every((s) => s.is_enabled)
      const allMcpDisabled = mcpServersOnly.length > 0 && mcpServersOnly.every((s) => !s.is_enabled)

      return (
        <div className="grid gap-6">
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{t('mcpServersDescription')}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddMcpServer}>
                <Plus className="mr-2 h-4 w-4" />
                {t('addServer')}
              </Button>
              {mcpServersOnly.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAllToolsEnabled('mcp', true)}
                    disabled={allMcpEnabled}
                  >
                    <ToggleRight className="mr-2 h-4 w-4" />
                    {t('enableAll')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAllToolsEnabled('mcp', false)}
                    disabled={allMcpDisabled}
                  >
                    <ToggleLeft className="mr-2 h-4 w-4" />
                    {t('disableAll')}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Server list */}
          {mcpServersOnly.length > 0 && (
            <div className="grid gap-3">
              {mcpServersOnly.map((server) => {
                const serverTransport = getTransportType(server)
                const serverConfig = parseMcpConfig(server.config)
                const status = connectionStatus[server.id] || 'idle'
                const probe = probeResults[server.id]
                const isNeedsAuth = status === 'needs_auth'

                return (
                  <div key={server.id} className="rounded-lg border p-4 max-w-lg">
                    <div className="grid gap-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="grid gap-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {(() => {
                              const dotClass = 'h-2 w-2 rounded-full shrink-0'
                              if (status === 'connecting')
                                return (
                                  <span
                                    className={`${dotClass} bg-yellow-500 animate-pulse`}
                                    title={t('connecting')}
                                  />
                                )
                              if (status === 'connected')
                                return (
                                  <span
                                    className={`${dotClass} bg-green-500`}
                                    title={t('connected')}
                                  />
                                )
                              if (status === 'needs_auth')
                                return (
                                  <span
                                    className={`${dotClass} bg-yellow-500`}
                                    title={t('authorizationRequired')}
                                  />
                                )
                              if (status === 'error')
                                return (
                                  <span
                                    className={`${dotClass} bg-red-500`}
                                    title={t('connectionFailed')}
                                  />
                                )
                              return (
                                <span
                                  className={`${dotClass} bg-muted-foreground/30`}
                                  title={t('notConnected')}
                                />
                              )
                            })()}
                            <span className="font-medium truncate">{server.name}</span>
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {serverTransport === 'http' ? 'HTTP' : 'STDIO'}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground truncate font-mono">
                            {serverTransport === 'http'
                              ? server.endpoint
                              : [serverConfig?.command, ...(serverConfig?.args ?? [])]
                                  .filter(Boolean)
                                  .join(' ')}
                          </span>
                          {server.description && (
                            <span className="text-xs text-muted-foreground">
                              {server.description}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => connectServer(server.id)}
                            disabled={status === 'connecting'}
                            title={t('refreshConnection')}
                          >
                            <RefreshCw
                              className={`h-4 w-4 ${status === 'connecting' ? 'animate-spin' : ''}`}
                            />
                          </Button>

                          {isNeedsAuth ? (
                            <Button
                              size="sm"
                              variant="default"
                              disabled={oauthAuthorizingId === server.id}
                              onClick={() => handleOAuthConnect(server.id)}
                            >
                              {oauthAuthorizingId === server.id ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : (
                                <LogIn className="h-4 w-4 mr-1" />
                              )}
                              {t('connect')}
                            </Button>
                          ) : (
                            <Switch
                              checked={server.is_enabled}
                              onCheckedChange={() => handleToggleMcpServer(server.id)}
                            />
                          )}

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditMcpServer(server)}
                          >
                            <Settings className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteMcpServer(server.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>

                      {/* OAuth discovery info */}
                      {isNeedsAuth && probe?.status === 'needs_oauth' && (
                        <p className="text-xs text-muted-foreground bg-yellow-500/10 rounded px-2 py-1.5">
                          {t('serverRequiresOauth')}
                          {probe.scopes_supported?.length
                            ? t('scopes', { scopes: probe.scopes_supported.join(', ') })
                            : ''}
                        </p>
                      )}

                      {/* Error with red indicator */}
                      {status === 'error' && connectionErrors[server.id] && (
                        <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5 break-all">
                          {connectionErrors[server.id]}
                          {probe?.status === 'error' && probe.error && (
                            <span className="block mt-1">{probe.error}</span>
                          )}
                        </p>
                      )}

                      {/* Connected tools list */}
                      {status === 'connected' &&
                        serverTools[server.id] &&
                        serverTools[server.id].length > 0 && (
                          <div className="border-t pt-2 mt-1">
                            <button
                              type="button"
                              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                              onClick={() =>
                                setExpandedToolsId(expandedToolsId === server.id ? null : server.id)
                              }
                            >
                              <ChevronDown
                                className={`h-3.5 w-3.5 transition-transform ${expandedToolsId === server.id ? '' : '-rotate-90'}`}
                              />
                              {serverTools[server.id].length} {t('tools')}
                            </button>
                            {expandedToolsId === server.id && (
                              <div className="mt-2 space-y-1 pl-5">
                                {serverTools[server.id].map((tool) => (
                                  <div key={tool.name} className="text-xs">
                                    <span className="font-mono font-medium text-foreground">
                                      {tool.name}
                                    </span>
                                    {tool.description && (
                                      <p className="text-muted-foreground mt-0.5 line-clamp-2">
                                        {tool.description}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {mcpServersOnly.length === 0 && !mcpLoading && (
            <div className="text-sm text-muted-foreground">{t('noMcpServersConfigured')}</div>
          )}

          {/* Config Modal */}
          <McpServerConfigModal
            open={mcpConfigModalOpen}
            onOpenChange={setMcpConfigModalOpen}
            editingServer={editingMcpServer}
          />
        </div>
      )
    }

    if (activeSection === 'skills') {
      const query = skillSearchQuery.toLowerCase().trim()
      const filteredSkills = query
        ? skills.filter(
            (s) =>
              s.name.toLowerCase().includes(query) ||
              (s.description && s.description.toLowerCase().includes(query))
          )
        : skills

      const hasSkills = skills.length > 0
      const allSkillsEnabled = hasSkills && skills.every((s) => s.is_enabled)
      const allSkillsDisabled = hasSkills && skills.every((s) => !s.is_enabled)

      const handleOpenSkillsDirectory = async (source: string) => {
        try {
          await invoke('open_skills_directory', { source })
        } catch (error) {
          logger.error('Failed to open skills directory:', error)
        }
      }

      const sourceLabel = (source: string) =>
        t(`settings:skillSourceLabels.${source}`, { defaultValue: source })

      const skillCountBySource = (source: SkillSource | string) =>
        getSkillsBySource(skills, source as SkillSource).length

      const filteredBuiltinSkills = filteredSkills.filter((s) => isBuiltinSkill(s))

      const renderSkillItem = (skill: Skill) => (
        <div
          key={skill.id}
          className="flex items-start justify-between gap-4 rounded-lg border p-4"
        >
          <div className="grid gap-1">
            <span className="font-medium">{skill.name}</span>
            {skill.description && (
              <p className="text-xs text-muted-foreground line-clamp-2" title={skill.description}>
                {skill.description}
              </p>
            )}
            {skill.required_tool_ids.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('settings:requiresTools', { count: skill.required_tool_ids.length })}
              </p>
            )}
          </div>
          <Switch checked={skill.is_enabled} onCheckedChange={() => handleToggleSkill(skill.id)} />
        </div>
      )

      const userSources = skillSources.filter((s) => s.source !== 'builtin')

      return (
        <div className="grid gap-6">
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{t('settings:skillsDescription')}</p>
            <div className="flex gap-2 flex-wrap">
              {hasSkills && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAllSkillsEnabled(true)}
                    disabled={allSkillsEnabled}
                  >
                    <ToggleRight className="mr-2 h-4 w-4" />
                    {t('settings:enableAll')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAllSkillsEnabled(false)}
                    disabled={allSkillsDisabled}
                  >
                    <ToggleLeft className="mr-2 h-4 w-4" />
                    {t('settings:disableAll')}
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={scanSkills} disabled={skillsLoading}>
                {skillsLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {t('settings:rescan')}
              </Button>
            </div>
          </div>

          {/* Skill Sources */}
          {userSources.length > 0 && (
            <div className="grid gap-3">
              <h4 className="text-sm font-medium">{t('settings:skillSources')}</h4>
              <div className="grid gap-2 max-w-lg">
                {userSources.map((src) => (
                  <div
                    key={src.source}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="grid gap-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{sourceLabel(src.source)}</span>
                        {src.enabled && (
                          <span className="text-xs text-muted-foreground">
                            {t('settings:skillCount', {
                              count: skillCountBySource(src.source),
                            })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{src.path}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {src.enabled && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleOpenSkillsDirectory(src.source)}
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {src.always_on ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div>
                              <Switch checked disabled />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>{t('settings:alwaysEnabled')}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Switch
                          checked={src.enabled}
                          onCheckedChange={(checked) =>
                            setSkillSourceEnabled(src.source, checked === true)
                          }
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skill Search & List */}
          {hasSkills ? (
            <div className="grid gap-4 max-w-lg">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={tc('common:search')}
                  value={skillSearchQuery}
                  onChange={(e) => setSkillSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {filteredSkills.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  {t('settings:noSkillsMatchSearch')}
                </p>
              ) : (
                <div className="grid gap-6">
                  {filteredBuiltinSkills.length > 0 && (
                    <div className="grid gap-3">
                      <h4 className="text-sm font-medium">{t('settings:builtInSkills')}</h4>
                      <div className="grid gap-3">{filteredBuiltinSkills.map(renderSkillItem)}</div>
                    </div>
                  )}

                  {SKILL_SOURCE_ORDER.filter((s) => s !== 'builtin').map((source) => {
                    const sourceSkills = getSkillsBySource(filteredSkills, source)
                    if (sourceSkills.length === 0) return null
                    return (
                      <div key={source} className="grid gap-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium">{sourceLabel(source)}</h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => handleOpenSkillsDirectory(source)}
                          >
                            <FolderOpen className="h-3 w-3" />
                            {t('settings:openDirectory')}
                          </Button>
                        </div>
                        <div className="grid gap-3">{sourceSkills.map(renderSkillItem)}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {skillsLoading ? t('settings:loadingSkills') : t('settings:noSkillsAvailable')}
            </div>
          )}
        </div>
      )
    }

    if (activeSection === 'auxModels') {
      const renderPicker = (
        elementId: string,
        label: string,
        selected: Model | undefined,
        onSave: (id: string) => void,
        description: string,
        showVisionBadge = false
      ) => (
        <div className="grid gap-2">
          <Label htmlFor={elementId}>{label}</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full max-w-md justify-between">
                <span className="truncate">
                  {selected ? selected.name : t('useCurrentConversationModel')}
                </span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[400px] max-h-[300px] overflow-y-auto">
              <DropdownMenuItem onClick={() => onSave('')}>
                <span>{t('useCurrentConversationModelDefault')}</span>
              </DropdownMenuItem>
              {showVisionBadge ? (
                <AuxVisionModelList
                  models={models}
                  getProviderById={getProviderById}
                  onSelect={onSave}
                />
              ) : (
                models.map((model) => (
                  <DropdownMenuItem key={model.id} onClick={() => onSave(model.id)}>
                    <span className="truncate">{model.name}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="text-xs text-muted-foreground max-w-md">{description}</p>
        </div>
      )

      return (
        <div className="grid gap-6">
          {renderPicker(
            'aux-tiny-model',
            t('auxTinyModel'),
            selectedTinyModel,
            handleSaveAuxTinyModel,
            t('chooseModelForTiny')
          )}
          {renderPicker(
            'aux-vision-model',
            t('auxVisionModel'),
            selectedVisionModel,
            handleSaveAuxVisionModel,
            t('chooseModelForVision'),
            true
          )}
        </div>
      )
    }

    if (activeSection === 'webFetch') {
      return (
        <div className="grid gap-6">
          {/* Mode Selection */}
          <div className="grid gap-2">
            <Label>{t('fetchMode')}</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full max-w-md justify-between">
                  <span>{webFetchMode === 'local' ? t('local') : t('api')}</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[400px]">
                <DropdownMenuItem onClick={() => handleSaveWebFetchMode('local')}>
                  <div className="flex items-center gap-2">
                    {webFetchMode === 'local' && <Check className="h-4 w-4 text-primary" />}
                    <span className={webFetchMode === 'local' ? 'font-medium' : ''}>
                      {t('local')}
                    </span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSaveWebFetchMode('api')}>
                  <div className="flex items-center gap-2">
                    {webFetchMode === 'api' && <Check className="h-4 w-4 text-primary" />}
                    <span className={webFetchMode === 'api' ? 'font-medium' : ''}>{t('api')}</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground max-w-md">{t('fetchModeDescription')}</p>
          </div>

          {/* Fetch Strategy Selection */}
          {webFetchMode === 'local' && (
            <div className="grid gap-2">
              <Label>{t('fetchStrategy')}</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full max-w-md justify-between">
                    <span>{t(FETCH_METHOD_LABELS[webFetchLocalMethod])}</span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[400px]">
                  <DropdownMenuItem onClick={() => handleSaveWebFetchLocalMethod('auto')}>
                    <div className="flex items-center gap-2">
                      {webFetchLocalMethod === 'auto' && <Check className="h-4 w-4 text-primary" />}
                      <div>
                        <span className={webFetchLocalMethod === 'auto' ? 'font-medium' : ''}>
                          {t('auto')}
                        </span>
                        <p className="text-xs text-muted-foreground">{t('tryHttpFirst')}</p>
                      </div>
                    </div>
                  </DropdownMenuItem>

                  {obscuraAvailable && (
                    <DropdownMenuItem onClick={() => handleSaveWebFetchLocalMethod('obscura')}>
                      <div className="flex items-center gap-2">
                        {webFetchLocalMethod === 'obscura' && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                        <div>
                          <span className={webFetchLocalMethod === 'obscura' ? 'font-medium' : ''}>
                            {t('alwaysUseObscura')}
                          </span>
                          <p className="text-xs text-muted-foreground">{t('obscuraSkipHttp')}</p>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => handleSaveWebFetchLocalMethod('fetch')}>
                    <div className="flex items-center gap-2">
                      {webFetchLocalMethod === 'fetch' && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                      <div>
                        <span className={webFetchLocalMethod === 'fetch' ? 'font-medium' : ''}>
                          {t('alwaysUseFetch')}
                        </span>
                        <p className="text-xs text-muted-foreground">{t('fasterMayFail')}</p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSaveWebFetchLocalMethod('webview')}>
                    <div className="flex items-center gap-2">
                      {webFetchLocalMethod === 'webview' && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                      <div>
                        <span className={webFetchLocalMethod === 'webview' ? 'font-medium' : ''}>
                          {t('alwaysUseWebview')}
                        </span>
                        <p className="text-xs text-muted-foreground">{t('webviewSkipHttp')}</p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                  {chromeAvailable && (
                    <DropdownMenuItem onClick={() => handleSaveWebFetchLocalMethod('headless')}>
                      <div className="flex items-center gap-2">
                        {webFetchLocalMethod === 'headless' && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                        <div>
                          <span className={webFetchLocalMethod === 'headless' ? 'font-medium' : ''}>
                            {t('alwaysUseChrome')}
                          </span>
                          <p className="text-xs text-muted-foreground">{t('chromeHeaviest')}</p>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Obscura install guidance: shown in local mode while the binary is absent */}
          {webFetchMode === 'local' && !obscuraAvailable && <ObscuraInstallHint />}

          {/* API Provider Selection */}
          {webFetchMode === 'api' && (
            <>
              <div className="grid gap-2">
                <Label>{t('apiProvider')}</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full max-w-md justify-between">
                      <span>{t('jinaReader')}</span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[400px]">
                    <DropdownMenuItem>
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        <div>
                          <span className="font-medium">{t('jinaReader')}</span>
                          <p className="text-xs text-muted-foreground">https://r.jina.ai/</p>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="jina-api-key">{t('jinaApiKeyOptional')}</Label>
                <div className="relative max-w-md">
                  <Input
                    id="jina-api-key"
                    type={showJinaApiKey ? 'text' : 'password'}
                    placeholder={t('enterJinaApiKey')}
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
                  {t('jinaApiKeyDescription')}
                </p>
              </div>
            </>
          )}
        </div>
      )
    }

    if (activeSection === 'webSearch') {
      return (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <Label htmlFor="search-provider">{t('searchEngine')}</Label>
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
            <p className="text-xs text-muted-foreground max-w-md">{t('chooseSearchEngine')}</p>
          </div>
        </div>
      )
    }

    if (activeSection === 'sync') {
      return <SyncSettingsSection />
    }

    if (activeSection === 'language') {
      return (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <Label>{t('language')}</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full max-w-md justify-between">
                  <span>
                    {supportedLanguages.find((l) => l.code === currentLanguage)?.name ??
                      currentLanguage}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[400px]">
                {supportedLanguages.map((lang) => (
                  <DropdownMenuItem
                    key={lang.code}
                    onClick={async () => {
                      await changeLanguage(lang.code)
                      setCurrentLanguage(lang.code)
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {lang.code === currentLanguage && <Check className="h-4 w-4 text-primary" />}
                      <span className={lang.code === currentLanguage ? 'font-medium' : ''}>
                        {lang.name}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground max-w-md">{t('languageDescription')}</p>
          </div>
        </div>
      )
    }

    if (activeSection === 'advanced') {
      const logLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error']

      return (
        <div className="grid gap-6">
          {/* Model Capabilities Database */}
          <div className="grid gap-2">
            <Label>{t('modelCapabilitiesDatabase')}</Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={capabilitiesRefreshing}
                onClick={async () => {
                  setCapabilitiesRefreshing(true)
                  try {
                    const count = await invoke<number>('refresh_capabilities_cache')
                    invalidateCapabilitiesCache()
                    await loadCapabilitiesInfo()
                    logger.info(`Refreshed capabilities: ${count} entries`)
                    toast.success(t('capabilitiesRefreshSuccess', { count }))
                  } catch (error) {
                    logger.error('Failed to refresh capabilities:', error)
                    toast.error(t('capabilitiesRefreshError'))
                  } finally {
                    setCapabilitiesRefreshing(false)
                  }
                }}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${capabilitiesRefreshing ? 'animate-spin' : ''}`}
                />
                {t('refreshFromModelsDev')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground max-w-md">
              {t('modelCapabilitiesDatabaseDescription')}
            </p>
            {capabilitiesInfo && (
              <p className="text-xs text-muted-foreground">
                {t('modelCapabilitiesDatabaseStatus', {
                  count: capabilitiesInfo.entry_count,
                  date: capabilitiesInfo.last_updated ?? '—',
                  source:
                    capabilitiesInfo.source === 'bundled'
                      ? t('capabilitiesSourceBundled')
                      : capabilitiesInfo.source === 'models_dev'
                        ? t('capabilitiesSourceModelsDev')
                        : t('capabilitiesSourceUnavailable'),
                })}
              </p>
            )}
          </div>

          {/* Rust Log Level */}
          <div className="grid gap-2">
            <Label>{t('backendLogLevel')}</Label>
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
                        <p className="text-xs text-muted-foreground">{t('logLevels.' + level)}</p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground max-w-md">
              {t('logLevelDescription', { type: t('backendType') })}
            </p>
          </div>

          {/* TypeScript Log Level */}
          <div className="grid gap-2">
            <Label>{t('frontendLogLevel')}</Label>
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
                        <p className="text-xs text-muted-foreground">{t('logLevels.' + level)}</p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground max-w-md">
              {t('logLevelDescription', { type: t('frontendType') })}
            </p>
          </div>

          {/* Log Storage */}
          <div className="grid gap-2">
            <Label>{t('logStorage')}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {logStorageInfo
                  ? t('logStorageSize', {
                      size: formatLogSize(logStorageInfo.total_bytes),
                      count: logStorageInfo.file_count,
                    })
                  : t('logStorageUnknown')}
              </span>
              <Button variant="outline" size="sm" onClick={handleOpenLogsDirectory}>
                <FolderOpen className="mr-2 h-4 w-4" />
                {t('openLogsDirectory')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={logDiagnosing}
                onClick={handleDiagnoseLogs}
              >
                <Stethoscope className={`mr-2 h-4 w-4 ${logDiagnosing ? 'animate-pulse' : ''}`} />
                {t('diagnoseLogs')}
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full max-w-md justify-between">
                  <span>
                    {logMaxTotalMb === 0
                      ? t('logSizeUnlimited')
                      : t('logSizeLimitValue', { mb: logMaxTotalMb })}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[400px]">
                {[10, 50, 100, 200, 500, 0].map((mb) => (
                  <DropdownMenuItem key={mb} onClick={() => handleSaveLogMaxTotalMb(mb)}>
                    <div className="flex items-center gap-2">
                      {mb === logMaxTotalMb && <Check className="h-4 w-4 text-primary" />}
                      <span className={mb === logMaxTotalMb ? 'font-medium' : ''}>
                        {mb === 0 ? t('logSizeUnlimited') : t('logSizeLimitValue', { mb })}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground max-w-md">{t('logStorageDescription')}</p>
          </div>
        </div>
      )
    }

    if (activeSection === 'about') {
      return (
        <div className="grid gap-6">
          <p className="text-sm text-muted-foreground max-w-md">{t('aboutNoTelemetry')}</p>

          <div className="grid gap-2">
            <Label>{t('aboutSupportTitle')}</Label>
            <p className="text-xs text-muted-foreground max-w-md">{t('aboutSupportDescription')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => openExternal(GITHUB_REPO_URL)}>
                <Star className="mr-2 h-4 w-4" />
                {t('aboutStarButton')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopyRecommendation}>
                <Share2 className="mr-2 h-4 w-4" />
                {t('aboutRecommendButton')}
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t('aboutIssuesTitle')}</Label>
            <p className="text-xs text-muted-foreground max-w-md">{t('aboutIssuesDescription')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => openExternal(GITHUB_ISSUES_URL)}>
                <Bug className="mr-2 h-4 w-4" />
                {t('aboutFileIssueButton')}
              </Button>
            </div>
          </div>

          {appVersion !== null && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <img src={appIcon} alt="ChatShell" className="size-4 rounded-[4px]" />
              {t('aboutVersion', { version: appVersion })}
            </p>
          )}
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
        <DialogTitle className="sr-only">{tc('settings')}</DialogTitle>
        <DialogDescription className="sr-only">{tc('settings')}</DialogDescription>
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
                          <span>{t(item.name)}</span>
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
                      <BreadcrumbLink href="#">{tc('settings')}</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{t(activeSection)}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div
              className={`flex flex-1 flex-col overflow-hidden ${activeSection === 'llmProvider' ? '' : 'gap-4 overflow-y-auto p-4 pt-0'}`}
            >
              {renderContent()}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
