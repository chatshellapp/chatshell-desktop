'use client'

import * as React from 'react'
import { Check, ChevronDown, Plus, Trash2, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useMcpStore } from '@/stores/mcpStore'
import type { Tool, McpTransportType, McpServerConfig } from '@/types'
import { parseMcpConfig, getTransportType } from '@/types'
import { logger } from '@/lib/logger'

interface HeaderEntry {
  key: string
  value: string
}

interface McpServerConfigModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingServer?: Tool | null
}

export function McpServerConfigModal({
  open,
  onOpenChange,
  editingServer,
}: McpServerConfigModalProps) {
  const [name, setName] = React.useState('')
  const [transport, setTransport] = React.useState<McpTransportType>('http')
  const [endpoint, setEndpoint] = React.useState('')
  const [command, setCommand] = React.useState('')
  const [args, setArgs] = React.useState('')
  const [env, setEnv] = React.useState('')
  const [cwd, setCwd] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [headers, setHeaders] = React.useState<HeaderEntry[]>([])
  const [saving, setSaving] = React.useState(false)

  const createServer = useMcpStore((s) => s.createServer)
  const updateServer = useMcpStore((s) => s.updateServer)
  const connectServer = useMcpStore((s) => s.connectServer)

  const isEditing = !!editingServer

  React.useEffect(() => {
    if (open && editingServer) {
      setName(editingServer.name)
      const config = parseMcpConfig(editingServer.config)
      const t = getTransportType(editingServer)
      setTransport(t)
      setEndpoint(editingServer.endpoint || '')
      setCommand(config?.command || '')
      setArgs(config?.args?.join('\n') || '')
      setEnv(formatEnv(config?.env))
      setCwd(config?.cwd || '')
      setDescription(editingServer.description || '')
      const h: HeaderEntry[] = config?.headers
        ? Object.entries(config.headers).map(([key, value]) => ({ key, value }))
        : []
      setHeaders(h)
    } else if (open && !editingServer) {
      resetForm()
    }
  }, [open, editingServer])

  const resetForm = () => {
    setName('')
    setTransport('http')
    setEndpoint('')
    setCommand('')
    setArgs('')
    setEnv('')
    setCwd('')
    setDescription('')
    setHeaders([])
    setSaving(false)
  }

  const parseArgs = (argsText: string): string[] => {
    return argsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  }

  const parseEnvVars = (envText: string): Record<string, string> => {
    const envMap: Record<string, string> = {}
    envText.split('\n').forEach((line) => {
      const trimmed = line.trim()
      if (trimmed && trimmed.includes('=')) {
        const eqIndex = trimmed.indexOf('=')
        const key = trimmed.substring(0, eqIndex).trim()
        const value = trimmed.substring(eqIndex + 1).trim()
        if (key) envMap[key] = value
      }
    })
    return envMap
  }

  const formatEnv = (envObj?: Record<string, string>): string => {
    if (!envObj) return ''
    return Object.entries(envObj)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  }

  const addHeader = () => {
    setHeaders([...headers, { key: '', value: '' }])
  }

  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index))
  }

  const updateHeader = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...headers]
    updated[index] = { ...updated[index], [field]: val }
    setHeaders(updated)
  }

  const buildHeadersMap = (): Record<string, string> | undefined => {
    const filtered = headers.filter((h) => h.key.trim())
    if (filtered.length === 0) return undefined
    const map: Record<string, string> = {}
    for (const h of filtered) {
      map[h.key.trim()] = h.value
    }
    return map
  }

  const canSave =
    name.trim() &&
    ((transport === 'http' && endpoint.trim()) || (transport === 'stdio' && command.trim()))

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)

    try {
      const config: McpServerConfig = {
        transport,
        command: transport === 'stdio' ? command.trim() : undefined,
        args: transport === 'stdio' && args.trim() ? parseArgs(args) : undefined,
        env: transport === 'stdio' && env.trim() ? parseEnvVars(env) : undefined,
        cwd: transport === 'stdio' && cwd.trim() ? cwd.trim() : undefined,
        headers: transport === 'http' ? buildHeadersMap() : undefined,
      }

      let serverId: string

      if (isEditing && editingServer) {
        const updated = await updateServer(
          editingServer.id,
          name.trim(),
          transport === 'http' ? endpoint.trim() : undefined,
          description.trim() || undefined,
          config
        )
        serverId = updated.id
      } else {
        const created = await createServer(
          name.trim(),
          transport === 'http' ? endpoint.trim() : undefined,
          description.trim() || undefined,
          config
        )
        serverId = created.id
      }

      onOpenChange(false)
      resetForm()

      // Auto-connect after save
      connectServer(serverId)
    } catch (error) {
      logger.error('Failed to save MCP server:', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit MCP Server' : 'Add MCP Server'}</DialogTitle>
          <DialogDescription>
            Configure an MCP server to extend your AI assistant with external tools.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Name */}
          <div className="grid gap-2">
            <Label htmlFor="mcp-modal-name">Name</Label>
            <Input
              id="mcp-modal-name"
              placeholder="My MCP Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Transport */}
          <div className="grid gap-2">
            <Label>Transport</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span>
                    {transport === 'http' ? 'HTTP (Streamable)' : 'STDIO (Local Process)'}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-full">
                <DropdownMenuItem onClick={() => setTransport('http')}>
                  <div className="flex items-center gap-2">
                    {transport === 'http' && <Check className="h-4 w-4 text-primary" />}
                    <div>
                      <span className={transport === 'http' ? 'font-medium' : ''}>
                        HTTP (Streamable)
                      </span>
                      <p className="text-xs text-muted-foreground">
                        Connect to a remote MCP server via HTTP
                      </p>
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTransport('stdio')}>
                  <div className="flex items-center gap-2">
                    {transport === 'stdio' && <Check className="h-4 w-4 text-primary" />}
                    <div>
                      <span className={transport === 'stdio' ? 'font-medium' : ''}>
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
          {transport === 'http' && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="mcp-modal-endpoint">Endpoint URL</Label>
                <Input
                  id="mcp-modal-endpoint"
                  placeholder="http://localhost:8080/mcp"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </div>

              {/* Headers */}
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label>Headers</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addHeader}
                    className="h-7 px-2 text-xs"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Header
                  </Button>
                </div>
                {headers.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No custom headers. Click "Add Header" to add request headers (e.g.
                    Authorization, X-API-Key).
                  </p>
                )}
                {headers.map((header, index) => (
                  <div key={index} className="flex gap-2 items-start">
                    <Input
                      placeholder="Header name"
                      value={header.key}
                      onChange={(e) => updateHeader(index, 'key', e.target.value)}
                      className="flex-1 font-mono text-sm"
                    />
                    <Input
                      placeholder="Value"
                      value={header.value}
                      onChange={(e) => updateHeader(index, 'value', e.target.value)}
                      className="flex-1 font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeHeader(index)}
                      className="shrink-0 h-9 w-9"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* STDIO-specific fields */}
          {transport === 'stdio' && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="mcp-modal-command">Command</Label>
                <Input
                  id="mcp-modal-command"
                  placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Full command with arguments, or just the executable
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mcp-modal-args">Arguments (one per line)</Label>
                <Textarea
                  id="mcp-modal-args"
                  placeholder={'/path/to/allowed/directory\n/another/directory'}
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  rows={3}
                  className="font-mono text-sm"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mcp-modal-env">Environment Variables (KEY=VALUE per line)</Label>
                <Textarea
                  id="mcp-modal-env"
                  placeholder={'API_KEY=your-api-key\nDEBUG=true'}
                  value={env}
                  onChange={(e) => setEnv(e.target.value)}
                  rows={2}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Custom environment variables (system environment is inherited)
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mcp-modal-cwd">Working Directory (optional)</Label>
                <Input
                  id="mcp-modal-cwd"
                  placeholder="~/projects/my-project"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Defaults to home directory if not specified
                </p>
              </div>
            </>
          )}

          {/* Description */}
          <div className="grid gap-2">
            <Label htmlFor="mcp-modal-description">Description (optional)</Label>
            <Input
              id="mcp-modal-description"
              placeholder="A brief description of this MCP server"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? 'Save' : 'Add Server'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
