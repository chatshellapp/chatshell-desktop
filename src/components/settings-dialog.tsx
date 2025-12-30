'use client'

import * as React from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FileDown,
  // Globe,
  Heading,
  // Home,
  // Keyboard,
  // Link,
  Loader2,
  // Lock,
  // Menu,
  // MessageCircle,
  // Paintbrush,
  Plug,
  Plus,
  Search,
  Settings,
  // Settings,
  Trash2,
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
import { useMcpStore } from '@/stores/mcpStore'
import { useModelStore } from '@/stores/modelStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type {
  SearchProviderId,
  WebFetchMode,
  WebFetchLocalMethod,
  LogLevel,
  Tool,
  McpTransportType,
  McpServerConfig,
} from '@/types'
import { parseMcpConfig, getTransportType } from '@/types'
import { Textarea } from '@/components/ui/textarea'
import { LLMProviderSettings } from '@/components/settings-dialog/llm-provider-settings'
import { logger } from '@/lib/logger'
import { Switch } from '@/components/ui/switch'

const data = {
  nav: [
    { name: 'LLM Provider', icon: Bot },
    { name: 'MCP Servers', icon: Plug },
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
  const [newMcpName, setNewMcpName] = React.useState('')
  const [newMcpTransport, setNewMcpTransport] = React.useState<McpTransportType>('http')
  const [newMcpEndpoint, setNewMcpEndpoint] = React.useState('')
  const [newMcpCommand, setNewMcpCommand] = React.useState('')
  const [newMcpArgs, setNewMcpArgs] = React.useState('')
  const [newMcpEnv, setNewMcpEnv] = React.useState('')
  const [newMcpCwd, setNewMcpCwd] = React.useState('')
  const [newMcpDescription, setNewMcpDescription] = React.useState('')
  const [editingMcpId, setEditingMcpId] = React.useState<string | null>(null)
  const [editMcpName, setEditMcpName] = React.useState('')
  const [editMcpTransport, setEditMcpTransport] = React.useState<McpTransportType>('http')
  const [editMcpEndpoint, setEditMcpEndpoint] = React.useState('')
  const [editMcpCommand, setEditMcpCommand] = React.useState('')
  const [editMcpArgs, setEditMcpArgs] = React.useState('')
  const [editMcpEnv, setEditMcpEnv] = React.useState('')
  const [editMcpCwd, setEditMcpCwd] = React.useState('')
  const [editMcpDescription, setEditMcpDescription] = React.useState('')
  const [testingMcpEndpoint, setTestingMcpEndpoint] = React.useState<string | null>(null)

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

  // MCP store methods
  const mcpServers = useMcpStore((state) => state.servers)
  const mcpLoading = useMcpStore((state) => state.isLoading)
  const loadMcpServers = useMcpStore((state) => state.loadServers)
  const createMcpServer = useMcpStore((state) => state.createServer)
  const updateMcpServer = useMcpStore((state) => state.updateServer)
  const deleteMcpServer = useMcpStore((state) => state.deleteServer)
  const toggleMcpServer = useMcpStore((state) => state.toggleServer)
  const testHttpConnection = useMcpStore((state) => state.testHttpConnection)
  const testStdioConnection = useMcpStore((state) => state.testStdioConnection)

  // Load models and settings when dialog opens
  React.useEffect(() => {
    if (open) {
      loadModels()
      loadSearchProviders()
      loadMcpServers()
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
    loadMcpServers,
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

  // Helper to parse args from textarea (one per line)
  const parseArgs = (argsText: string): string[] => {
    return argsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  }

  // Helper to parse env vars from textarea (KEY=VALUE per line)
  const parseEnv = (envText: string): Record<string, string> => {
    const env: Record<string, string> = {}
    envText.split('\n').forEach((line) => {
      const trimmed = line.trim()
      if (trimmed && trimmed.includes('=')) {
        const eqIndex = trimmed.indexOf('=')
        const key = trimmed.substring(0, eqIndex).trim()
        const value = trimmed.substring(eqIndex + 1).trim()
        if (key) {
          env[key] = value
        }
      }
    })
    return env
  }

  // Helper to format env vars for textarea
  const formatEnv = (env?: Record<string, string>): string => {
    if (!env) return ''
    return Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  }

  // MCP handlers
  const handleCreateMcpServer = async () => {
    if (!newMcpName.trim()) return

    // Validate based on transport type
    if (newMcpTransport === 'http' && !newMcpEndpoint.trim()) return
    if (newMcpTransport === 'stdio' && !newMcpCommand.trim()) return

    try {
      const config: McpServerConfig = {
        transport: newMcpTransport,
        command: newMcpTransport === 'stdio' ? newMcpCommand.trim() : undefined,
        args: newMcpTransport === 'stdio' && newMcpArgs.trim() ? parseArgs(newMcpArgs) : undefined,
        env: newMcpTransport === 'stdio' && newMcpEnv.trim() ? parseEnv(newMcpEnv) : undefined,
        cwd: newMcpTransport === 'stdio' && newMcpCwd.trim() ? newMcpCwd.trim() : undefined,
      }

      await createMcpServer(
        newMcpName.trim(),
        newMcpTransport === 'http' ? newMcpEndpoint.trim() : undefined,
        newMcpDescription.trim() || undefined,
        config
      )

      // Reset form
      setNewMcpName('')
      setNewMcpTransport('http')
      setNewMcpEndpoint('')
      setNewMcpCommand('')
      setNewMcpArgs('')
      setNewMcpEnv('')
      setNewMcpCwd('')
      setNewMcpDescription('')
    } catch (error) {
      logger.error('Failed to create MCP server:', error)
    }
  }

  const handleUpdateMcpServer = async (id: string) => {
    if (!editMcpName.trim()) return

    // Validate based on transport type
    if (editMcpTransport === 'http' && !editMcpEndpoint.trim()) return
    if (editMcpTransport === 'stdio' && !editMcpCommand.trim()) return

    try {
      const config: McpServerConfig = {
        transport: editMcpTransport,
        command: editMcpTransport === 'stdio' ? editMcpCommand.trim() : undefined,
        args:
          editMcpTransport === 'stdio' && editMcpArgs.trim() ? parseArgs(editMcpArgs) : undefined,
        env: editMcpTransport === 'stdio' && editMcpEnv.trim() ? parseEnv(editMcpEnv) : undefined,
        cwd: editMcpTransport === 'stdio' && editMcpCwd.trim() ? editMcpCwd.trim() : undefined,
      }

      await updateMcpServer(
        id,
        editMcpName.trim(),
        editMcpTransport === 'http' ? editMcpEndpoint.trim() : undefined,
        editMcpDescription.trim() || undefined,
        config
      )
      setEditingMcpId(null)
    } catch (error) {
      logger.error('Failed to update MCP server:', error)
    }
  }

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

  const handleTestMcpConnection = async () => {
    if (newMcpTransport === 'http') {
      if (!newMcpEndpoint.trim()) return
      setTestingMcpEndpoint(newMcpEndpoint)
      try {
        await testHttpConnection(newMcpEndpoint.trim())
        logger.info('HTTP MCP connection test successful')
      } catch (error) {
        logger.error('HTTP MCP connection test failed:', error)
      } finally {
        setTestingMcpEndpoint(null)
      }
    } else {
      if (!newMcpCommand.trim()) return
      setTestingMcpEndpoint(newMcpCommand)
      try {
        const config: McpServerConfig = {
          transport: 'stdio',
          command: newMcpCommand.trim(),
          args: newMcpArgs.trim() ? parseArgs(newMcpArgs) : undefined,
          env: newMcpEnv.trim() ? parseEnv(newMcpEnv) : undefined,
          cwd: newMcpCwd.trim() ? newMcpCwd.trim() : undefined,
        }
        await testStdioConnection(config)
        logger.info('STDIO MCP connection test successful')
      } catch (error) {
        logger.error('STDIO MCP connection test failed:', error)
      } finally {
        setTestingMcpEndpoint(null)
      }
    }
  }

  const startEditingMcp = (server: Tool) => {
    setEditingMcpId(server.id)
    setEditMcpName(server.name)
    const config = parseMcpConfig(server.config)
    const transport = getTransportType(server)
    setEditMcpTransport(transport)
    setEditMcpEndpoint(server.endpoint || '')
    setEditMcpCommand(config?.command || '')
    setEditMcpArgs(config?.args?.join('\n') || '')
    setEditMcpEnv(formatEnv(config?.env))
    setEditMcpCwd(config?.cwd || '')
    setEditMcpDescription(server.description || '')
  }

  const cancelEditingMcp = () => {
    setEditingMcpId(null)
    setEditMcpName('')
    setEditMcpTransport('http')
    setEditMcpEndpoint('')
    setEditMcpCommand('')
    setEditMcpArgs('')
    setEditMcpEnv('')
    setEditMcpCwd('')
    setEditMcpDescription('')
  }

  const selectedModel = summaryModelId ? getModelById(summaryModelId) : null
  const selectedSearchProvider = searchProviders.find((p) => p.id === searchProviderId)

  const renderContent = () => {
    if (activeSection === 'LLM Provider') {
      return <LLMProviderSettings open={open} />
    }

    if (activeSection === 'MCP Servers') {
      const canCreateServer =
        newMcpName.trim() &&
        ((newMcpTransport === 'http' && newMcpEndpoint.trim()) ||
          (newMcpTransport === 'stdio' && newMcpCommand.trim()))

      const canTestConnection =
        (newMcpTransport === 'http' && newMcpEndpoint.trim()) ||
        (newMcpTransport === 'stdio' && newMcpCommand.trim())

      const canUpdateServer =
        editMcpName.trim() &&
        ((editMcpTransport === 'http' && editMcpEndpoint.trim()) ||
          (editMcpTransport === 'stdio' && editMcpCommand.trim()))

      return (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground max-w-md">
              Configure MCP (Model Context Protocol) servers to extend your AI assistant with
              external tools and capabilities. Supports both HTTP and STDIO transports.
            </p>
          </div>

          {/* Add new MCP server */}
          <div className="grid gap-3 rounded-lg border p-4 max-w-lg">
            <h4 className="text-sm font-medium">Add New MCP Server</h4>

            {/* Name */}
            <div className="grid gap-2">
              <Label htmlFor="mcp-name">Name</Label>
              <Input
                id="mcp-name"
                placeholder="My MCP Server"
                value={newMcpName}
                onChange={(e) => setNewMcpName(e.target.value)}
              />
            </div>

            {/* Transport Type */}
            <div className="grid gap-2">
              <Label>Transport</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span>
                      {newMcpTransport === 'http' ? 'HTTP (Streamable)' : 'STDIO (Local Process)'}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full">
                  <DropdownMenuItem onClick={() => setNewMcpTransport('http')}>
                    <div className="flex items-center gap-2">
                      {newMcpTransport === 'http' && <Check className="h-4 w-4 text-primary" />}
                      <div>
                        <span className={newMcpTransport === 'http' ? 'font-medium' : ''}>
                          HTTP (Streamable)
                        </span>
                        <p className="text-xs text-muted-foreground">
                          Connect to a remote MCP server via HTTP
                        </p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setNewMcpTransport('stdio')}>
                    <div className="flex items-center gap-2">
                      {newMcpTransport === 'stdio' && <Check className="h-4 w-4 text-primary" />}
                      <div>
                        <span className={newMcpTransport === 'stdio' ? 'font-medium' : ''}>
                          STDIO (Local Process)
                        </span>
                        <p className="text-xs text-muted-foreground">
                          Run a local MCP server as a subprocess
                        </p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* HTTP-specific fields */}
            {newMcpTransport === 'http' && (
              <div className="grid gap-2">
                <Label htmlFor="mcp-endpoint">Endpoint URL</Label>
                <Input
                  id="mcp-endpoint"
                  placeholder="http://localhost:8080/mcp"
                  value={newMcpEndpoint}
                  onChange={(e) => setNewMcpEndpoint(e.target.value)}
                />
              </div>
            )}

            {/* STDIO-specific fields */}
            {newMcpTransport === 'stdio' && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="mcp-command">Command</Label>
                  <Input
                    id="mcp-command"
                    placeholder="npx -y @modelcontextprotocol/server-filesystem"
                    value={newMcpCommand}
                    onChange={(e) => setNewMcpCommand(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Full command with arguments, or just the executable (e.g., npx, uvx)
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="mcp-args">Arguments (one per line)</Label>
                  <Textarea
                    id="mcp-args"
                    placeholder={'/path/to/allowed/directory\n/another/directory'}
                    value={newMcpArgs}
                    onChange={(e) => setNewMcpArgs(e.target.value)}
                    rows={3}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="mcp-env">Environment Variables (KEY=VALUE per line)</Label>
                  <Textarea
                    id="mcp-env"
                    placeholder={'API_KEY=your-api-key\nDEBUG=true'}
                    value={newMcpEnv}
                    onChange={(e) => setNewMcpEnv(e.target.value)}
                    rows={2}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Custom environment variables (system environment is inherited)
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="mcp-cwd">Working Directory (optional)</Label>
                  <Input
                    id="mcp-cwd"
                    placeholder="~/projects/my-project"
                    value={newMcpCwd}
                    onChange={(e) => setNewMcpCwd(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Defaults to home directory if not specified
                  </p>
                </div>
              </>
            )}

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="mcp-description">Description (optional)</Label>
              <Input
                id="mcp-description"
                placeholder="A brief description of this MCP server"
                value={newMcpDescription}
                onChange={(e) => setNewMcpDescription(e.target.value)}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={handleCreateMcpServer} disabled={!canCreateServer || mcpLoading}>
                <Plus className="mr-2 h-4 w-4" />
                Add Server
              </Button>
              {canTestConnection && (
                <Button
                  variant="outline"
                  onClick={handleTestMcpConnection}
                  disabled={!!testingMcpEndpoint}
                >
                  {testingMcpEndpoint ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plug className="mr-2 h-4 w-4" />
                  )}
                  Test
                </Button>
              )}
            </div>
          </div>

          {/* List of existing MCP servers */}
          {mcpServers.length > 0 && (
            <div className="grid gap-3">
              <h4 className="text-sm font-medium">Configured Servers</h4>
              {mcpServers.map((server) => {
                const serverTransport = getTransportType(server)
                const serverConfig = parseMcpConfig(server.config)

                return (
                  <div key={server.id} className="rounded-lg border p-4 max-w-lg">
                    {editingMcpId === server.id ? (
                      <div className="grid gap-3">
                        {/* Edit Name */}
                        <div className="grid gap-2">
                          <Label>Name</Label>
                          <Input
                            value={editMcpName}
                            onChange={(e) => setEditMcpName(e.target.value)}
                          />
                        </div>

                        {/* Edit Transport */}
                        <div className="grid gap-2">
                          <Label>Transport</Label>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" className="w-full justify-between">
                                <span>
                                  {editMcpTransport === 'http'
                                    ? 'HTTP (Streamable)'
                                    : 'STDIO (Local Process)'}
                                </span>
                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-full">
                              <DropdownMenuItem onClick={() => setEditMcpTransport('http')}>
                                <div className="flex items-center gap-2">
                                  {editMcpTransport === 'http' && (
                                    <Check className="h-4 w-4 text-primary" />
                                  )}
                                  <span
                                    className={editMcpTransport === 'http' ? 'font-medium' : ''}
                                  >
                                    HTTP (Streamable)
                                  </span>
                                </div>
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setEditMcpTransport('stdio')}>
                                <div className="flex items-center gap-2">
                                  {editMcpTransport === 'stdio' && (
                                    <Check className="h-4 w-4 text-primary" />
                                  )}
                                  <span
                                    className={editMcpTransport === 'stdio' ? 'font-medium' : ''}
                                  >
                                    STDIO (Local Process)
                                  </span>
                                </div>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        {/* Edit HTTP fields */}
                        {editMcpTransport === 'http' && (
                          <div className="grid gap-2">
                            <Label>Endpoint URL</Label>
                            <Input
                              value={editMcpEndpoint}
                              onChange={(e) => setEditMcpEndpoint(e.target.value)}
                            />
                          </div>
                        )}

                        {/* Edit STDIO fields */}
                        {editMcpTransport === 'stdio' && (
                          <>
                            <div className="grid gap-2">
                              <Label>Command</Label>
                              <Input
                                value={editMcpCommand}
                                onChange={(e) => setEditMcpCommand(e.target.value)}
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label>Arguments (one per line)</Label>
                              <Textarea
                                value={editMcpArgs}
                                onChange={(e) => setEditMcpArgs(e.target.value)}
                                rows={3}
                                className="font-mono text-sm"
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label>Environment Variables</Label>
                              <Textarea
                                value={editMcpEnv}
                                onChange={(e) => setEditMcpEnv(e.target.value)}
                                rows={2}
                                className="font-mono text-sm"
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label>Working Directory</Label>
                              <Input
                                value={editMcpCwd}
                                onChange={(e) => setEditMcpCwd(e.target.value)}
                              />
                            </div>
                          </>
                        )}

                        {/* Edit Description */}
                        <div className="grid gap-2">
                          <Label>Description</Label>
                          <Input
                            value={editMcpDescription}
                            onChange={(e) => setEditMcpDescription(e.target.value)}
                          />
                        </div>

                        {/* Edit Actions */}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleUpdateMcpServer(server.id)}
                            disabled={!canUpdateServer}
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelEditingMcp}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-4">
                        <div className="grid gap-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{server.name}</span>
                            <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                              {serverTransport === 'http' ? 'HTTP' : 'STDIO'}
                            </span>
                            {server.is_enabled ? (
                              <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                                Enabled
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                Disabled
                              </span>
                            )}
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
                          <Switch
                            checked={server.is_enabled}
                            onCheckedChange={() => handleToggleMcpServer(server.id)}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => startEditingMcp(server)}
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
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {mcpServers.length === 0 && !mcpLoading && (
            <div className="text-sm text-muted-foreground">
              No MCP servers configured yet. Add one above to get started.
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
