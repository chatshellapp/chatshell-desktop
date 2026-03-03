import * as React from 'react'
import {
  Plug,
  RotateCcw,
  Wrench,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  ChevronDown,
  LogIn,
  Loader2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMcpStore } from '@/stores/mcpStore'
import { isBuiltinTool, isMcpTool, sortBuiltinTools } from '@/types/tool'
import { logger } from '@/lib/logger'

interface McpServersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  enabledServerIds: string[]
  onServerIdsChange: (serverIds: string[]) => void
}

export function McpServersDialog({
  open,
  onOpenChange,
  enabledServerIds,
  onServerIdsChange,
}: McpServersDialogProps) {
  const servers = useMcpStore((state) => state.servers)
  const ensureLoaded = useMcpStore((state) => state.ensureLoaded)
  const connectServer = useMcpStore((state) => state.connectServer)
  const connectionStatus = useMcpStore((state) => state.connectionStatus)
  const serverTools = useMcpStore((state) => state.serverTools)
  const connectionErrors = useMcpStore((state) => state.connectionErrors)
  const startOAuth = useMcpStore((state) => state.startOAuth)
  const loadServers = useMcpStore((state) => state.loadServers)
  const [expandedToolsId, setExpandedToolsId] = React.useState<string | null>(null)
  const [oauthAuthorizingId, setOauthAuthorizingId] = React.useState<string | null>(null)

  const handleOAuthConnect = async (serverId: string) => {
    setOauthAuthorizingId(serverId)
    try {
      await startOAuth(serverId)
      await loadServers()
      connectServer(serverId)
    } catch (e) {
      logger.error('OAuth connect failed', e)
    } finally {
      setOauthAuthorizingId(null)
    }
  }

  React.useEffect(() => {
    if (open) {
      ensureLoaded()
    }
  }, [open, ensureLoaded])

  const builtinTools = sortBuiltinTools(servers.filter((s) => isBuiltinTool(s)))
  const mcpServers = servers.filter((s) => isMcpTool(s))

  // Global enabled IDs include both builtin and MCP
  const globalEnabledIds = React.useMemo(
    () => servers.filter((s) => s.is_enabled).map((s) => s.id),
    [servers]
  )

  const isDifferentFromGlobal = React.useMemo(() => {
    if (enabledServerIds.length !== globalEnabledIds.length) return true
    const sortedCurrent = [...enabledServerIds].sort()
    const sortedGlobal = [...globalEnabledIds].sort()
    return !sortedCurrent.every((id, index) => id === sortedGlobal[index])
  }, [enabledServerIds, globalEnabledIds])

  const handleToggleServer = (serverId: string, checked: boolean) => {
    if (checked) {
      onServerIdsChange([...enabledServerIds, serverId])
    } else {
      onServerIdsChange(enabledServerIds.filter((id) => id !== serverId))
    }
  }

  const handleResetToGlobal = () => {
    onServerIdsChange(globalEnabledIds)
  }

  const hasNoTools = builtinTools.length === 0 && mcpServers.length === 0
  const [activeTab, setActiveTab] = React.useState<string>('mcp-servers')

  const tabItems = React.useMemo(() => {
    return activeTab === 'builtin-tools' ? builtinTools : mcpServers
  }, [activeTab, builtinTools, mcpServers])

  const tabAvailableIds = React.useMemo(() => {
    return tabItems.filter((s) => s.is_enabled).map((s) => s.id)
  }, [tabItems])

  const allEnabled =
    tabAvailableIds.length > 0 && tabAvailableIds.every((id) => enabledServerIds.includes(id))
  const noneEnabled =
    tabAvailableIds.length > 0 && !tabAvailableIds.some((id) => enabledServerIds.includes(id))

  const renderToolItem = (tool: (typeof servers)[number]) => {
    const isGloballyDisabled = !tool.is_enabled
    const isConversationEnabled = enabledServerIds.includes(tool.id)
    const isMcp = isMcpTool(tool)
    const rawStatus = isMcp ? (connectionStatus[tool.id] || 'idle') : null
    const status = isMcp && !isConversationEnabled ? 'idle' : rawStatus
    const tools = isMcp ? (serverTools[tool.id] || []) : []
    const error = isMcp ? connectionErrors[tool.id] : null

    return (
      <div
        key={tool.id}
        className={`py-2 pl-2 ${isGloballyDisabled ? 'opacity-50' : ''}`}
      >
        <div className="flex items-center justify-between">
          <div className="grid gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {isMcp && (() => {
                const dotClass = 'h-2 w-2 rounded-full shrink-0'
                if (status === 'connecting') return <span className={`${dotClass} bg-yellow-500 animate-pulse`} title="Connecting..." />
                if (status === 'connected') return <span className={`${dotClass} bg-green-500`} title="Connected" />
                if (status === 'needs_auth') return <span className={`${dotClass} bg-yellow-500`} title="Authorization required" />
                if (status === 'error') return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={`${dotClass} bg-red-500 cursor-help`} />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[250px]">{error || 'Connection failed'}</TooltipContent>
                  </Tooltip>
                )
                return <span className={`${dotClass} bg-muted-foreground/30`} title="Not connected" />
              })()}
              <Label
                htmlFor={tool.id}
                className={`text-sm font-medium leading-none ${isGloballyDisabled ? 'text-muted-foreground' : ''}`}
              >
                {tool.name}
              </Label>
            </div>
            {tool.description && (
              <p className="text-xs text-muted-foreground max-w-[280px]">{tool.description}</p>
            )}
            {isMcp && tool.endpoint && (
              <p className="text-xs text-muted-foreground truncate max-w-[280px]">{tool.endpoint}</p>
            )}
            {isGloballyDisabled && (
              <p className="text-xs text-muted-foreground/70 italic">Disabled in Settings</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isMcp && !isGloballyDisabled && rawStatus !== 'needs_auth' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => connectServer(tool.id)}
                disabled={rawStatus === 'connecting'}
                title="Refresh connection"
              >
                {rawStatus === 'connecting' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            {isMcp && rawStatus === 'needs_auth' ? (
              <Button
                size="sm"
                variant="default"
                disabled={oauthAuthorizingId === tool.id}
                onClick={() => handleOAuthConnect(tool.id)}
              >
                {oauthAuthorizingId === tool.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <LogIn className="h-3.5 w-3.5 mr-1" />
                )}
                Connect
              </Button>
            ) : isGloballyDisabled ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Switch id={tool.id} checked={false} disabled />
                  </div>
                </TooltipTrigger>
                <TooltipContent>Enable this tool in Settings first</TooltipContent>
              </Tooltip>
            ) : (
              <Switch
                id={tool.id}
                checked={isConversationEnabled}
                onCheckedChange={(checked) => handleToggleServer(tool.id, checked === true)}
              />
            )}
          </div>
        </div>

        {isMcp && isConversationEnabled && rawStatus === 'connected' && tools.length > 0 && (
          <div className="mt-1.5 ml-0">
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setExpandedToolsId(expandedToolsId === tool.id ? null : tool.id)}
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${expandedToolsId === tool.id ? '' : '-rotate-90'}`}
              />
              {tools.length} tool{tools.length !== 1 ? 's' : ''}
            </button>
            {expandedToolsId === tool.id && (
              <div className="mt-1.5 space-y-1 pl-4">
                {tools.map((t) => (
                  <div key={t.name} className="text-xs">
                    <span className="font-mono font-medium">{t.name}</span>
                    {t.description && (
                      <p className="text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const handleTabEnableAll = () => {
    const idsToAdd = tabAvailableIds.filter((id) => !enabledServerIds.includes(id))
    onServerIdsChange([...enabledServerIds, ...idsToAdd])
  }

  const handleTabDisableAll = () => {
    const tabIdSet = new Set(tabAvailableIds)
    onServerIdsChange(enabledServerIds.filter((id) => !tabIdSet.has(id)))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] max-h-[70vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Tools & MCP
          </DialogTitle>
          <DialogDescription>
            Select which tools to enable for this conversation. Tools give the AI additional
            capabilities like searching the web or reading web pages.
          </DialogDescription>
        </DialogHeader>

        {hasNoTools ? (
          <div className="px-6 py-8">
            <p className="text-sm text-muted-foreground text-center">
              No tools available. Enable builtin tools or configure MCP servers in Settings.
            </p>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 gap-0">
            <div className="px-6 pt-2 pb-0">
              <TabsList className="w-full">
                <TabsTrigger value="mcp-servers" className="gap-1.5">
                  <Plug className="h-3.5 w-3.5" />
                  MCP Servers
                  {mcpServers.length > 0 && (
                    <span className="text-xs text-muted-foreground ml-0.5">({mcpServers.length})</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="builtin-tools" className="gap-1.5">
                  <Wrench className="h-3.5 w-3.5" />
                  Built-in Tools
                  {builtinTools.length > 0 && (
                    <span className="text-xs text-muted-foreground ml-0.5">({builtinTools.length})</span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {tabAvailableIds.length > 0 && (
              <div className="flex gap-2 px-6 pt-3 pb-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTabEnableAll}
                  disabled={allEnabled}
                  className="gap-1.5"
                >
                  <ToggleRight className="h-3.5 w-3.5" />
                  Enable All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTabDisableAll}
                  disabled={noneEnabled}
                  className="gap-1.5"
                >
                  <ToggleLeft className="h-3.5 w-3.5" />
                  Disable All
                </Button>
              </div>
            )}

            <TabsContent value="mcp-servers" className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
              {mcpServers.length > 0 ? (
                <div className="space-y-1">
                  {mcpServers.map(renderToolItem)}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No MCP servers configured. Add servers in Settings.
                </p>
              )}
            </TabsContent>

            <TabsContent value="builtin-tools" className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
              {builtinTools.length > 0 ? (
                <div className="space-y-1">
                  {builtinTools.map(renderToolItem)}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No built-in tools available.
                </p>
              )}
            </TabsContent>
          </Tabs>
        )}

        {isDifferentFromGlobal && (
          <div className="px-6 pb-6">
            <Separator className="mb-4" />
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={handleResetToGlobal} className="gap-2">
                <RotateCcw className="h-4 w-4" />
                Reset to Global Settings
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
