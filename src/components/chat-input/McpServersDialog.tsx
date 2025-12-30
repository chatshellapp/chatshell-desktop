import * as React from 'react'
import { Plug, RotateCcw } from 'lucide-react'
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

  const enabledMcpServers = servers.filter((s) => s.type === 'mcp' && s.is_enabled)

  const globalEnabledMcpIds = React.useMemo(
    () => enabledMcpServers.map((s) => s.id),
    [enabledMcpServers]
  )

  const isDifferentFromGlobal = React.useMemo(() => {
    if (enabledServerIds.length !== globalEnabledMcpIds.length) return true
    const sortedCurrent = [...enabledServerIds].sort()
    const sortedGlobal = [...globalEnabledMcpIds].sort()
    return !sortedCurrent.every((id, index) => id === sortedGlobal[index])
  }, [enabledServerIds, globalEnabledMcpIds])

  const handleToggleServer = (serverId: string, checked: boolean) => {
    if (checked) {
      onServerIdsChange([...enabledServerIds, serverId])
    } else {
      onServerIdsChange(enabledServerIds.filter((id) => id !== serverId))
    }
  }

  const handleResetToGlobal = () => {
    onServerIdsChange(globalEnabledMcpIds)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            MCP Servers
          </DialogTitle>
          <DialogDescription>
            Select which MCP servers to use for this conversation. Selected servers will provide
            additional tools to the AI assistant.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {enabledMcpServers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No MCP servers available. Configure servers in Settings &gt; MCP Servers.
            </p>
          ) : (
            enabledMcpServers.map((server) => (
              <div key={server.id} className="flex items-center justify-between py-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={server.id} className="text-sm font-medium leading-none">
                    {server.name}
                  </Label>
                  {server.description && (
                    <p className="text-xs text-muted-foreground">{server.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                    {server.endpoint}
                  </p>
                </div>
                <Switch
                  id={server.id}
                  checked={enabledServerIds.includes(server.id)}
                  onCheckedChange={(checked) => handleToggleServer(server.id, checked === true)}
                />
              </div>
            ))
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
