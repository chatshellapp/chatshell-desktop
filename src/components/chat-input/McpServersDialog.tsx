import * as React from 'react'
import { Plug, RotateCcw, Wrench, ToggleLeft, ToggleRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMcpStore } from '@/stores/mcpStore'
import { isBuiltinTool, isMcpTool } from '@/types/tool'

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
  const loadServers = useMcpStore((state) => state.loadServers)

  React.useEffect(() => {
    if (open) {
      loadServers()
    }
  }, [open, loadServers])

  const builtinTools = servers.filter((s) => isBuiltinTool(s))
  const mcpServers = servers.filter((s) => isMcpTool(s))

  // Global enabled IDs include both builtin and MCP
  const globalEnabledIds = React.useMemo(
    () => servers.filter((s) => s.is_enabled).map((s) => s.id),
    [servers]
  )

  // All available IDs (globally enabled)
  const allAvailableIds = globalEnabledIds

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

  const handleEnableAll = () => {
    onServerIdsChange(allAvailableIds)
  }

  const handleDisableAll = () => {
    onServerIdsChange([])
  }

  const hasNoTools = builtinTools.length === 0 && mcpServers.length === 0

  // Check if all available (globally enabled) items are enabled/disabled for this conversation
  const allEnabled =
    allAvailableIds.length > 0 && allAvailableIds.every((id) => enabledServerIds.includes(id))
  const noneEnabled =
    allAvailableIds.length > 0 && !allAvailableIds.some((id) => enabledServerIds.includes(id))

  const renderToolItem = (tool: (typeof servers)[number]) => {
    const isGloballyDisabled = !tool.is_enabled
    const isConversationEnabled = enabledServerIds.includes(tool.id)

    return (
      <div
        key={tool.id}
        className={`flex items-center justify-between py-2 pl-2 ${isGloballyDisabled ? 'opacity-50' : ''}`}
      >
        <div className="grid gap-1">
          <Label
            htmlFor={tool.id}
            className={`text-sm font-medium leading-none ${isGloballyDisabled ? 'text-muted-foreground' : ''}`}
          >
            {tool.name}
          </Label>
          {tool.description && (
            <p className="text-xs text-muted-foreground max-w-[280px]">{tool.description}</p>
          )}
          {isMcpTool(tool) && tool.endpoint && (
            <p className="text-xs text-muted-foreground truncate max-w-[280px]">{tool.endpoint}</p>
          )}
          {isGloballyDisabled && (
            <p className="text-xs text-muted-foreground/70 italic">Disabled in Settings</p>
          )}
        </div>
        {isGloballyDisabled ? (
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
    )
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

        {/* Enable All / Disable All buttons */}
        {!hasNoTools && allAvailableIds.length > 0 && (
          <div className="flex gap-2 px-6 pb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleEnableAll}
              disabled={allEnabled}
              className="gap-1.5"
            >
              <ToggleRight className="h-3.5 w-3.5" />
              Enable All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisableAll}
              disabled={noneEnabled}
              className="gap-1.5"
            >
              <ToggleLeft className="h-3.5 w-3.5" />
              Disable All
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0 grid gap-4">
          {hasNoTools ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No tools available. Enable builtin tools or configure MCP servers in Settings.
            </p>
          ) : (
            <>
              {/* Builtin Tools Section */}
              {builtinTools.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Wrench className="h-4 w-4" />
                    Built-in Tools
                  </h4>
                  {builtinTools.map(renderToolItem)}
                </div>
              )}

              {/* Separator between sections */}
              {builtinTools.length > 0 && mcpServers.length > 0 && <Separator />}

              {/* MCP Servers Section */}
              {mcpServers.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Plug className="h-4 w-4" />
                    MCP Servers
                  </h4>
                  {mcpServers.map(renderToolItem)}
                </div>
              )}
            </>
          )}
        </div>

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
