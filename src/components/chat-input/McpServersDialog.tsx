import * as React from 'react'
import { Plug } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
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

  // Load servers when dialog opens
  React.useEffect(() => {
    if (open) {
      loadServers()
    }
  }, [open, loadServers])

  // Filter to only enabled MCP servers
  const enabledMcpServers = servers.filter((s) => s.type === 'mcp' && s.is_enabled)

  const handleToggleServer = (serverId: string, checked: boolean) => {
    if (checked) {
      onServerIdsChange([...enabledServerIds, serverId])
    } else {
      onServerIdsChange(enabledServerIds.filter((id) => id !== serverId))
    }
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
              <div key={server.id} className="flex items-start space-x-3">
                <Checkbox
                  id={server.id}
                  checked={enabledServerIds.includes(server.id)}
                  onCheckedChange={(checked) => handleToggleServer(server.id, checked === true)}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor={server.id}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {server.name}
                  </Label>
                  {server.description && (
                    <p className="text-xs text-muted-foreground">{server.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                    {server.endpoint}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
