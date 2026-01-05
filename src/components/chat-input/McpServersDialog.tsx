import * as React from 'react'
import { Plug, RotateCcw, Wrench } from 'lucide-react'
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

  // Separate builtin tools and MCP servers
  const builtinTools = servers.filter((s) => isBuiltinTool(s) && s.is_enabled)
  const mcpServers = servers.filter((s) => isMcpTool(s) && s.is_enabled)

  // Global enabled IDs include both builtin and MCP
  const globalEnabledIds = React.useMemo(
    () => [...builtinTools, ...mcpServers].map((s) => s.id),
    [builtinTools, mcpServers]
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Tools & MCP
          </DialogTitle>
          <DialogDescription>
            Select which tools to enable for this conversation. Tools give the AI additional
            capabilities like searching the web or reading web pages.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
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
                  {builtinTools.map((tool) => (
                    <div key={tool.id} className="flex items-center justify-between py-2 pl-2">
                      <div className="grid gap-1">
                        <Label htmlFor={tool.id} className="text-sm font-medium leading-none">
                          {tool.name}
                        </Label>
                        {tool.description && (
                          <p className="text-xs text-muted-foreground max-w-[280px]">
                            {tool.description}
                          </p>
                        )}
                      </div>
                      <Switch
                        id={tool.id}
                        checked={enabledServerIds.includes(tool.id)}
                        onCheckedChange={(checked) => handleToggleServer(tool.id, checked === true)}
                      />
                    </div>
                  ))}
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
                  {mcpServers.map((server) => (
                    <div key={server.id} className="flex items-center justify-between py-2 pl-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor={server.id} className="text-sm font-medium leading-none">
                          {server.name}
                        </Label>
                        {server.description && (
                          <p className="text-xs text-muted-foreground">{server.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground truncate max-w-[280px]">
                          {server.endpoint}
                        </p>
                      </div>
                      <Switch
                        id={server.id}
                        checked={enabledServerIds.includes(server.id)}
                        onCheckedChange={(checked) =>
                          handleToggleServer(server.id, checked === true)
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {isDifferentFromGlobal && (
          <>
            <Separator />
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={handleResetToGlobal} className="gap-2">
                <RotateCcw className="h-4 w-4" />
                Reset to Global Settings
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
