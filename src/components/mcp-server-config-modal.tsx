'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Plus, Trash2, Loader2, FileJson, ArrowLeft } from 'lucide-react'

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

interface ParsedServerConfig {
  name: string
  transport: McpTransportType
  command: string
  args: string
  env: string
  cwd: string
  endpoint: string
  headers: HeaderEntry[]
  error?: string
}

// Parses a standard MCP JSON config (Claude Desktop / Cursor format) into form fields.
// Supports:
//   { "mcpServers": { "Name": { "command": "...", ... } } }   -- wrapped format
//   { "command": "...", "args": [...], "env": {...} }          -- bare STDIO server
//   { "type": "http", "url": "https://..." }                   -- bare HTTP server
function parseMcpJsonConfig(jsonText: string): ParsedServerConfig {
  const empty: ParsedServerConfig = {
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    env: '',
    cwd: '',
    endpoint: '',
    headers: [],
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText.trim())
  } catch {
    return { ...empty, error: 'invalidJson' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ...empty, error: 'invalidJson' }
  }

  const obj = parsed as Record<string, unknown>

  // Unwrap { "mcpServers": { ... } } format
  let serverName = ''
  let serverObj: Record<string, unknown> = obj

  if (obj.mcpServers && typeof obj.mcpServers === 'object' && obj.mcpServers !== null) {
    const servers = obj.mcpServers as Record<string, unknown>
    const entries = Object.entries(servers)
    if (entries.length === 0) {
      return { ...empty, error: 'noServerFound' }
    }
    const [firstKey, firstValue] = entries[0]
    serverName = firstKey
    if (typeof firstValue !== 'object' || firstValue === null) {
      return { ...empty, error: 'noServerFound' }
    }
    serverObj = firstValue as Record<string, unknown>
  }

  // Detect transport type
  const hasUrl = typeof serverObj.url === 'string'
  const hasCommand = typeof serverObj.command === 'string'
  const typeField = typeof serverObj.type === 'string' ? serverObj.type : ''
  const isHttp = hasUrl || typeField === 'http' || typeField === 'sse' || typeField === 'streamable-http'

  if (!hasUrl && !hasCommand) {
    return { ...empty, error: 'noServerFound' }
  }

  const formatEnvObj = (envObj: unknown): string => {
    if (!envObj || typeof envObj !== 'object') return ''
    return Object.entries(envObj as Record<string, unknown>)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('\n')
  }

  const formatArgsArray = (argsArr: unknown): string => {
    if (!Array.isArray(argsArr)) return ''
    return argsArr.map((a) => String(a)).join('\n')
  }

  const buildHeaderEntries = (headersObj: unknown): HeaderEntry[] => {
    if (!headersObj || typeof headersObj !== 'object') return []
    return Object.entries(headersObj as Record<string, unknown>).map(([key, value]) => ({
      key,
      value: String(value),
    }))
  }

  if (isHttp) {
    return {
      name: serverName,
      transport: 'http',
      command: '',
      args: '',
      env: '',
      cwd: '',
      endpoint: typeof serverObj.url === 'string' ? serverObj.url : '',
      headers: buildHeaderEntries(serverObj.headers),
    }
  }

  // STDIO
  return {
    name: serverName,
    transport: 'stdio',
    command: typeof serverObj.command === 'string' ? serverObj.command : '',
    args: formatArgsArray(serverObj.args),
    env: formatEnvObj(serverObj.env),
    cwd: typeof serverObj.cwd === 'string' ? serverObj.cwd : '',
    endpoint: '',
    headers: [],
  }
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
  const { t } = useTranslation('tools')
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

  // JSON paste mode state
  const [showJsonInput, setShowJsonInput] = React.useState(false)
  const [jsonText, setJsonText] = React.useState('')
  const [jsonError, setJsonError] = React.useState<string | null>(null)

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
    setShowJsonInput(false)
    setJsonText('')
    setJsonError(null)
  }

  const parseArgs = (argsText: string): string[] => {
    return argsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  }

  const stripQuotes = (s: string): string => {
    if (s.length >= 2) {
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1)
      }
    }
    return s
  }

  const parseEnvVars = (envText: string): Record<string, string> => {
    const envMap: Record<string, string> = {}
    envText.split('\n').forEach((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      if (trimmed.includes('=')) {
        const eqIndex = trimmed.indexOf('=')
        const key = trimmed.substring(0, eqIndex).trim()
        const value = stripQuotes(trimmed.substring(eqIndex + 1).trim())
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

  const handleApplyJson = () => {
    setJsonError(null)
    const result = parseMcpJsonConfig(jsonText)
    if (result.error) {
      setJsonError(result.error)
      return
    }
    setName(result.name)
    setTransport(result.transport)
    setEndpoint(result.endpoint)
    setCommand(result.command)
    setArgs(result.args)
    setEnv(result.env)
    setCwd(result.cwd)
    setHeaders(result.headers)
    setShowJsonInput(false)
    setJsonText('')
    setJsonError(null)
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

  const handleBackToForm = () => {
    setShowJsonInput(false)
    setJsonText('')
    setJsonError(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {showJsonInput ? (
              <button
                type="button"
                onClick={handleBackToForm}
                className="flex items-center gap-2 hover:text-muted-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" />
                {t('pasteJsonConfig')}
              </button>
            ) : isEditing ? (
              t('editServer')
            ) : (
              t('addServer')
            )}
          </DialogTitle>
          <DialogDescription>{t('configureMcpServer')}</DialogDescription>
        </DialogHeader>

        {showJsonInput ? (
          /* JSON paste view */
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Textarea
                id="mcp-modal-json"
                placeholder={t('pasteJsonPlaceholder')}
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value)
                  setJsonError(null)
                }}
                rows={10}
                className="font-mono text-sm"
                autoFocus
              />
              {jsonError && (
                <p className="text-xs text-destructive">
                  {jsonError === 'invalidJson'
                    ? t('jsonParseError')
                    : jsonError === 'noServerFound'
                      ? t('jsonNoServerFound')
                      : jsonError}
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Button onClick={handleApplyJson} disabled={!jsonText.trim()}>
                {t('applyJsonConfig')}
              </Button>
            </div>
          </div>
        ) : (
          /* Normal form view */
          <>
            {/* JSON import shortcut — only in create mode */}
            {!isEditing && (
              <button
                type="button"
                onClick={() => setShowJsonInput(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
              >
                <FileJson className="h-3.5 w-3.5" />
                {t('pasteJsonConfig')}
              </button>
            )}

            <div className="grid gap-4 py-2">
              {/* Name */}
              <div className="grid gap-2">
                <Label htmlFor="mcp-modal-name">{t('name')}</Label>
                <Input
                  id="mcp-modal-name"
                  placeholder={t('serverNamePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {/* Transport */}
              <div className="grid gap-2">
                <Label>{t('transport')}</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      <span>
                        {transport === 'http' ? t('httpStreamable') : t('stdioLocalProcess')}
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
                            {t('httpStreamable')}
                          </span>
                          <p className="text-xs text-muted-foreground">{t('connectRemoteMcp')}</p>
                        </div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTransport('stdio')}>
                      <div className="flex items-center gap-2">
                        {transport === 'stdio' && <Check className="h-4 w-4 text-primary" />}
                        <div>
                          <span className={transport === 'stdio' ? 'font-medium' : ''}>
                            {t('stdioLocalProcess')}
                          </span>
                          <p className="text-xs text-muted-foreground">{t('runLocalMcp')}</p>
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
                    <Label htmlFor="mcp-modal-endpoint">{t('endpoint')}</Label>
                    <Input
                      id="mcp-modal-endpoint"
                      placeholder={t('endpointUrlPlaceholder')}
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                    />
                  </div>

                  {/* Headers */}
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label>{t('headers')}</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={addHeader}
                        className="h-7 px-2 text-xs"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        {t('addHeader')}
                      </Button>
                    </div>
                    {headers.length === 0 && (
                      <p className="text-xs text-muted-foreground">{t('noCustomHeaders')}</p>
                    )}
                    {headers.map((header, index) => (
                      <div key={index} className="flex gap-2 items-start">
                        <Input
                          placeholder={t('headerNamePlaceholder')}
                          value={header.key}
                          onChange={(e) => updateHeader(index, 'key', e.target.value)}
                          className="flex-1 font-mono text-sm"
                        />
                        <Input
                          placeholder={t('headerValuePlaceholder')}
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
                    <Label htmlFor="mcp-modal-command">{t('command')}</Label>
                    <Input
                      id="mcp-modal-command"
                      placeholder="npx -y @modelcontextprotocol/server-filesystem"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t('commandHelp')}</p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="mcp-modal-args">{t('argsOnePerLine')}</Label>
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
                    <Label htmlFor="mcp-modal-env">{t('envVarsKeyValue')}</Label>
                    <Textarea
                      id="mcp-modal-env"
                      placeholder={'API_KEY=your-api-key\nDEBUG=true'}
                      value={env}
                      onChange={(e) => setEnv(e.target.value)}
                      rows={2}
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">{t('envVarsInheritHelp')}</p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="mcp-modal-cwd">{t('workingDirectoryOptional')}</Label>
                    <Input
                      id="mcp-modal-cwd"
                      placeholder="~/projects/my-project"
                      value={cwd}
                      onChange={(e) => setCwd(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t('cwdHelp')}</p>
                  </div>
                </>
              )}

              {/* Description */}
              <div className="grid gap-2">
                <Label htmlFor="mcp-modal-description">{t('descriptionOptional')}</Label>
                <Input
                  id="mcp-modal-description"
                  placeholder={t('descriptionPlaceholder')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                {t('cancel')}
              </Button>
              <Button onClick={handleSave} disabled={!canSave || saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? t('save') : t('addServer')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
