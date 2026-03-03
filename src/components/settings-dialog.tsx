'use client'

import * as React from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FileDown,
  Globe,
  Heading,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  TerminalSquare,
  Trash2,
  Wrench,
  Zap,
  FolderOpen,
  ToggleLeft,
  ToggleRight,
  LogIn,
} from 'lucide-react'

import { invoke } from '@tauri-apps/api/core'
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
import { useMcpStore } from '@/stores/mcpStore'
import { useModelStore } from '@/stores/modelStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSkillStore } from '@/stores/skillStore'
import type {
  SearchProviderId,
  WebFetchMode,
  WebFetchLocalMethod,
  LogLevel,
  Tool,
  Skill,
} from '@/types'
import {
  parseMcpConfig,
  getTransportType,
  isBuiltinTool,
  sortBuiltinTools,
  isMcpTool,
  isBuiltinSkill,
  isUserSkill,
} from '@/types'
import { LLMProviderSettings } from '@/components/settings-dialog/llm-provider-settings'
import { logger } from '@/lib/logger'
import { Switch } from '@/components/ui/switch'
import { McpServerConfigModal } from '@/components/mcp-server-config-modal'

const data = {
  nav: [
    { name: 'LLM Provider', icon: Bot },
    { name: 'Built-in Tools', icon: Wrench },
    { name: 'MCP Servers', icon: Plug },
    { name: 'Skills', icon: Zap },
    { name: 'Conversation Title', icon: Heading },
    { name: 'Web Fetch', icon: FileDown },
    { name: 'Web Search', icon: Search },
    { name: 'Advanced', icon: Settings },
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

  // MCP state
  const [mcpConfigModalOpen, setMcpConfigModalOpen] = React.useState(false)
  const [editingMcpServer, setEditingMcpServer] = React.useState<Tool | null>(null)
  const [expandedToolsId, setExpandedToolsId] = React.useState<string | null>(null)
  const [oauthAuthorizingId, setOauthAuthorizingId] = React.useState<string | null>(null)

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

  // Skill store methods
  const skills = useSkillStore((state) => state.skills)
  const skillsLoading = useSkillStore((state) => state.isLoading)
  const ensureSkillsLoaded = useSkillStore((state) => state.ensureLoaded)
  const scanSkills = useSkillStore((state) => state.scanSkills)
  const toggleSkill = useSkillStore((state) => state.toggleSkill)
  const setAllSkillsEnabled = useSkillStore((state) => state.setAllEnabled)

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
      loadModels()
      loadSearchProviders()
      ensureMcpLoaded()
      ensureSkillsLoaded()
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
    ensureMcpLoaded,
    ensureSkillsLoaded,
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

  const selectedModel = summaryModelId ? getModelById(summaryModelId) : null
  const selectedSearchProvider = searchProviders.find((p) => p.id === searchProviderId)

  // Separate builtin tools and MCP servers
  const builtinTools = sortBuiltinTools(mcpServers.filter((s) => isBuiltinTool(s)))
  const mcpServersOnly = mcpServers.filter((s) => isMcpTool(s))

  // Separate builtin and user skills
  const builtinSkills = skills.filter((s: Skill) => isBuiltinSkill(s))
  const userSkills = skills.filter((s: Skill) => isUserSkill(s))

  const handleToggleSkill = async (id: string) => {
    try {
      await toggleSkill(id)
    } catch (error) {
      logger.error('Failed to toggle skill:', error)
    }
  }

  const renderContent = () => {
    if (activeSection === 'LLM Provider') {
      return <LLMProviderSettings open={open} />
    }

    if (activeSection === 'Built-in Tools') {
      const allBuiltinEnabled = builtinTools.length > 0 && builtinTools.every((t) => t.is_enabled)
      const allBuiltinDisabled = builtinTools.length > 0 && builtinTools.every((t) => !t.is_enabled)

      return (
        <div className="grid gap-6">
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Built-in tools provide core capabilities that enhance your AI assistant. Enable the
              tools you want to use globally, then configure them per conversation.
            </p>
            {builtinTools.length > 0 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAllToolsEnabled('builtin', true)}
                  disabled={allBuiltinEnabled}
                >
                  <ToggleRight className="mr-2 h-4 w-4" />
                  Enable All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAllToolsEnabled('builtin', false)}
                  disabled={allBuiltinDisabled}
                >
                  <ToggleLeft className="mr-2 h-4 w-4" />
                  Disable All
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
                    {tool.id === 'builtin-web-search' ? (
                      <Search className="h-5 w-5 text-muted-foreground mt-0.5" />
                    ) : tool.id === 'builtin-web-fetch' ? (
                      <Globe className="h-5 w-5 text-muted-foreground mt-0.5" />
                    ) : tool.id === 'builtin-bash' ? (
                      <TerminalSquare className="h-5 w-5 text-muted-foreground mt-0.5" />
                    ) : (
                      <Wrench className="h-5 w-5 text-muted-foreground mt-0.5" />
                    )}
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
              {mcpLoading ? 'Loading built-in tools...' : 'No built-in tools available.'}
            </div>
          )}
        </div>
      )
    }

    if (activeSection === 'MCP Servers') {
      const allMcpEnabled = mcpServersOnly.length > 0 && mcpServersOnly.every((s) => s.is_enabled)
      const allMcpDisabled = mcpServersOnly.length > 0 && mcpServersOnly.every((s) => !s.is_enabled)

      return (
        <div className="grid gap-6">
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Configure MCP (Model Context Protocol) servers to extend your AI assistant with
              external tools and capabilities. Supports both HTTP and STDIO transports.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddMcpServer}>
                <Plus className="mr-2 h-4 w-4" />
                Add Server
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
                    Enable All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAllToolsEnabled('mcp', false)}
                    disabled={allMcpDisabled}
                  >
                    <ToggleLeft className="mr-2 h-4 w-4" />
                    Disable All
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
                              if (status === 'connecting') return <span className={`${dotClass} bg-yellow-500 animate-pulse`} title="Connecting..." />
                              if (status === 'connected') return <span className={`${dotClass} bg-green-500`} title="Connected" />
                              if (status === 'needs_auth') return <span className={`${dotClass} bg-yellow-500`} title="Authorization required" />
                              if (status === 'error') return <span className={`${dotClass} bg-red-500`} title="Connection failed" />
                              return <span className={`${dotClass} bg-muted-foreground/30`} title="Not connected" />
                            })()}
                            <span className="font-medium truncate">{server.name}</span>
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {serverTransport === 'http' ? 'HTTP' : 'STDIO'}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground truncate font-mono">
                            {serverTransport === 'http' ? server.endpoint : serverConfig?.command}
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
                            title="Refresh connection"
                          >
                            <RefreshCw className={`h-4 w-4 ${status === 'connecting' ? 'animate-spin' : ''}`} />
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
                              Connect
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
                          Server requires OAuth authorization.
                          {probe.scopes_supported?.length
                            ? ` Scopes: ${probe.scopes_supported.join(', ')}`
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
                      {status === 'connected' && serverTools[server.id] && serverTools[server.id].length > 0 && (
                        <div className="border-t pt-2 mt-1">
                          <button
                            type="button"
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                            onClick={() => setExpandedToolsId(expandedToolsId === server.id ? null : server.id)}
                          >
                            <ChevronDown
                              className={`h-3.5 w-3.5 transition-transform ${expandedToolsId === server.id ? '' : '-rotate-90'}`}
                            />
                            {serverTools[server.id].length} tool{serverTools[server.id].length !== 1 ? 's' : ''}
                          </button>
                          {expandedToolsId === server.id && (
                            <div className="mt-2 space-y-1 pl-5">
                              {serverTools[server.id].map((tool) => (
                                <div key={tool.name} className="text-xs">
                                  <span className="font-mono font-medium text-foreground">{tool.name}</span>
                                  {tool.description && (
                                    <p className="text-muted-foreground mt-0.5 line-clamp-2">{tool.description}</p>
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
            <div className="text-sm text-muted-foreground">
              No MCP servers configured yet. Click "Add Server" to get started.
            </div>
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

    if (activeSection === 'Skills') {
      const hasSkills = builtinSkills.length > 0 || userSkills.length > 0
      const allSkillsArr = [...builtinSkills, ...userSkills]
      const allSkillsEnabled = allSkillsArr.length > 0 && allSkillsArr.every((s) => s.is_enabled)
      const allSkillsDisabled = allSkillsArr.length > 0 && allSkillsArr.every((s) => !s.is_enabled)

      const handleOpenSkillsDirectory = async () => {
        try {
          await invoke('open_skills_directory')
        } catch (error) {
          logger.error('Failed to open skills directory:', error)
        }
      }

      const renderSkillItem = (skill: Skill) => (
        <div
          key={skill.id}
          className="flex items-start justify-between gap-4 rounded-lg border p-4"
        >
          <div className="grid gap-1">
            <span className="font-medium">{skill.name}</span>
            {skill.description && (
              <p className="text-xs text-muted-foreground">{skill.description}</p>
            )}
            {skill.required_tool_ids.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Requires {skill.required_tool_ids.length} tool(s)
              </p>
            )}
          </div>
          <Switch checked={skill.is_enabled} onCheckedChange={() => handleToggleSkill(skill.id)} />
        </div>
      )

      return (
        <div className="grid gap-6">
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Skills are prompt instruction bundles that enhance your AI assistant with specialized
              capabilities. Enable or disable them globally here, then fine-tune per conversation.
            </p>
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
                    Enable All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAllSkillsEnabled(false)}
                    disabled={allSkillsDisabled}
                  >
                    <ToggleLeft className="mr-2 h-4 w-4" />
                    Disable All
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={handleOpenSkillsDirectory}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Open Directory
              </Button>
              <Button variant="outline" size="sm" onClick={scanSkills} disabled={skillsLoading}>
                {skillsLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Rescan
              </Button>
            </div>
          </div>

          {hasSkills ? (
            <div className="grid gap-6 max-w-lg">
              {builtinSkills.length > 0 && (
                <div className="grid gap-3">
                  <h4 className="text-sm font-medium">Built-in Skills</h4>
                  <div className="grid gap-3">{builtinSkills.map(renderSkillItem)}</div>
                </div>
              )}

              {userSkills.length > 0 && (
                <div className="grid gap-3">
                  <h4 className="text-sm font-medium">User Skills</h4>
                  <div className="grid gap-3">{userSkills.map(renderSkillItem)}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {skillsLoading
                ? 'Loading skills...'
                : 'No skills available. Place SKILL.md files in ~/.chatshell/skills/ to add custom skills.'}
            </div>
          )}
        </div>
      )
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

    if (activeSection === 'Advanced') {
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
            <Label>Backend Log Level</Label>
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
            <Label>Frontend Log Level</Label>
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
