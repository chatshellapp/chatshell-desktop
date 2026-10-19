import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useMcpStore } from '../mcpStore'
import type { McpToolInfo, OAuthStatusResult } from '../mcpStore'
import type { McpServerConfig, ProbeResult, Tool } from '@/types'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock opener plugin (startOAuth opens the browser)
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}))

// Mock logger to avoid console noise
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

const mockInvoke = vi.mocked(invoke)
const mockOpenUrl = vi.mocked(openUrl)

const createServer = (overrides: Partial<Tool> = {}): Tool => ({
  id: 's1',
  name: 'Server One',
  type: 'mcp',
  endpoint: 'http://localhost:3000',
  is_enabled: true,
  auth_token: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const resetStore = () => {
  useMcpStore.setState({
    servers: [],
    isLoading: false,
    error: null,
    testingEndpoint: null,
    testResult: null,
    testError: null,
    connectionStatus: {},
    serverTools: {},
    connectionErrors: {},
    probeResults: {},
  })
}

// Dispatches mocked invoke calls by command name so multi-invoke flows stay explicit
const dispatchInvoke = (handlers: Record<string, () => unknown> & { default?: () => unknown }) => {
  mockInvoke.mockImplementation((cmd: string) => {
    const handler = handlers[cmd] ?? handlers.default
    if (!handler) return Promise.reject(new Error(`unexpected command ${cmd}`))
    return Promise.resolve(handler())
  })
}

describe('useMcpStore (extended)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  describe('updateServer', () => {
    it('replaces the matching server in place and returns it', async () => {
      useMcpStore.setState({ servers: [createServer({ id: 'a' }), createServer({ id: 'b' })] })
      const updated = createServer({ id: 'a', name: 'Renamed', is_enabled: false })
      mockInvoke.mockResolvedValue(updated)

      const result = await useMcpStore
        .getState()
        .updateServer(
          'a',
          'Renamed',
          'http://x',
          'desc',
          { transport: 'stdio', command: 'uvx' },
          false
        )

      expect(mockInvoke).toHaveBeenCalledWith('update_mcp_server', {
        id: 'a',
        name: 'Renamed',
        endpoint: 'http://x',
        description: 'desc',
        config: { transport: 'stdio', command: 'uvx' },
        isEnabled: false,
      })
      expect(result).toEqual(updated)
      const servers = useMcpStore.getState().servers
      expect(servers).toHaveLength(2)
      expect(servers[0]).toEqual(updated)
      expect(servers[1].id).toBe('b')
      expect(useMcpStore.getState().isLoading).toBe(false)
    })

    it('keeps the list unchanged when the id is unknown but still returns the response', async () => {
      const existing = createServer({ id: 'a' })
      useMcpStore.setState({ servers: [existing] })
      const ghost = createServer({ id: 'ghost' })
      mockInvoke.mockResolvedValue(ghost)

      const result = await useMcpStore.getState().updateServer('ghost', 'Ghost')

      expect(result).toEqual(ghost)
      expect(useMcpStore.getState().servers).toEqual([existing])
      expect(useMcpStore.getState().isLoading).toBe(false)
    })

    it('rethrows and records the error on failure', async () => {
      useMcpStore.setState({ servers: [createServer({ id: 'a' })] })
      mockInvoke.mockRejectedValue(new Error('update failed'))

      await expect(useMcpStore.getState().updateServer('a', 'X')).rejects.toThrow('update failed')

      const state = useMcpStore.getState()
      expect(state.servers).toHaveLength(1)
      expect(state.error).toContain('update failed')
      expect(state.isLoading).toBe(false)
    })
  })

  describe('toggleServer', () => {
    it('replaces the toggled server with the backend response', async () => {
      useMcpStore.setState({ servers: [createServer({ id: 'a', is_enabled: true })] })
      const toggled = createServer({ id: 'a', is_enabled: false })
      mockInvoke.mockResolvedValue(toggled)

      const result = await useMcpStore.getState().toggleServer('a')

      expect(mockInvoke).toHaveBeenCalledWith('toggle_mcp_server', { id: 'a' })
      expect(result).toEqual(toggled)
      expect(useMcpStore.getState().servers[0]).toEqual(toggled)
      expect(useMcpStore.getState().isLoading).toBe(false)
    })

    it('rethrows and records the error on failure', async () => {
      useMcpStore.setState({ servers: [createServer({ id: 'a' })] })
      mockInvoke.mockRejectedValue(new Error('toggle failed'))

      await expect(useMcpStore.getState().toggleServer('a')).rejects.toThrow('toggle failed')

      const state = useMcpStore.getState()
      expect(state.servers[0].is_enabled).toBe(true)
      expect(state.error).toContain('toggle failed')
      expect(state.isLoading).toBe(false)
    })
  })

  describe('setAllEnabled', () => {
    it('replaces every server of the given type with the backend response', async () => {
      const builtin = createServer({ id: 'b1', type: 'builtin' })
      useMcpStore.setState({
        servers: [createServer({ id: 'm1' }), builtin, createServer({ id: 'm2' })],
      })
      const returned = [createServer({ id: 'm1', is_enabled: true }), createServer({ id: 'm3' })]
      mockInvoke.mockResolvedValue(returned)

      await useMcpStore.getState().setAllEnabled('mcp', true)

      expect(mockInvoke).toHaveBeenCalledWith('set_all_tools_enabled', {
        toolType: 'mcp',
        enabled: true,
      })
      expect(useMcpStore.getState().servers).toEqual([builtin, ...returned])
    })

    it('rethrows and keeps the current servers on failure', async () => {
      const existing = [createServer({ id: 'm1' })]
      useMcpStore.setState({ servers: existing })
      mockInvoke.mockRejectedValue(new Error('bulk failed'))

      await expect(useMcpStore.getState().setAllEnabled('mcp', true)).rejects.toThrow('bulk failed')

      expect(useMcpStore.getState().servers).toEqual(existing)
    })
  })
  describe('deleteServer', () => {
    it('rethrows and keeps the server when the backend delete fails', async () => {
      const existing = [createServer({ id: 'a' })]
      useMcpStore.setState({ servers: existing })
      mockInvoke.mockRejectedValue(new Error('delete failed'))

      await expect(useMcpStore.getState().deleteServer('a')).rejects.toThrow('delete failed')

      const state = useMcpStore.getState()
      expect(state.servers).toEqual(existing)
      expect(state.error).toContain('delete failed')
      expect(state.isLoading).toBe(false)
    })
  })

  describe('testHttpConnection', () => {
    it('tracks the in-flight endpoint and stores the discovered tools on success', async () => {
      const tools: McpToolInfo[] = [{ name: 'echo' }, { name: 'fetch', description: 'Get a URL' }]
      let resolveInvocation!: (tools: McpToolInfo[]) => void
      mockInvoke.mockImplementation(
        () =>
          new Promise<McpToolInfo[]>((resolve) => {
            resolveInvocation = resolve
          })
      )

      const pending = useMcpStore.getState().testHttpConnection('http://localhost:9000/sse')

      expect(useMcpStore.getState().testingEndpoint).toBe('http://localhost:9000/sse')
      expect(useMcpStore.getState().testResult).toBeNull()

      resolveInvocation(tools)
      await expect(pending).resolves.toEqual(tools)

      expect(mockInvoke).toHaveBeenCalledWith('test_mcp_connection', {
        endpoint: 'http://localhost:9000/sse',
      })
      const state = useMcpStore.getState()
      expect(state.testResult).toEqual(tools)
      expect(state.testingEndpoint).toBeNull()
      expect(state.testError).toBeNull()
    })

    it('records the failure and clears the endpoint under test on rejection', async () => {
      mockInvoke.mockRejectedValue(new Error('connection refused'))

      await expect(useMcpStore.getState().testHttpConnection('http://bad')).rejects.toThrow(
        'connection refused'
      )

      const state = useMcpStore.getState()
      expect(state.testError).toContain('connection refused')
      expect(state.testingEndpoint).toBeNull()
      expect(state.testResult).toBeNull()
    })
  })

  describe('testStdioConnection', () => {
    it('uses the command as the in-flight label and stores the tools on success', async () => {
      const config: McpServerConfig = { transport: 'stdio', command: 'npx', args: ['-y', 'srv'] }
      const tools: McpToolInfo[] = [{ name: 'stdio-tool' }]
      let resolveInvocation!: (tools: McpToolInfo[]) => void
      mockInvoke.mockImplementation(
        () =>
          new Promise<McpToolInfo[]>((resolve) => {
            resolveInvocation = resolve
          })
      )

      const pending = useMcpStore.getState().testStdioConnection(config)

      expect(useMcpStore.getState().testingEndpoint).toBe('npx')

      resolveInvocation(tools)
      await expect(pending).resolves.toEqual(tools)

      expect(mockInvoke).toHaveBeenCalledWith('test_mcp_stdio_connection', { config })
      const state = useMcpStore.getState()
      expect(state.testResult).toEqual(tools)
      expect(state.testingEndpoint).toBeNull()
    })

    it('labels the in-flight test as stdio when the config has no command', async () => {
      let resolveInvocation!: (tools: McpToolInfo[]) => void
      mockInvoke.mockImplementation(
        () =>
          new Promise<McpToolInfo[]>((resolve) => {
            resolveInvocation = resolve
          })
      )

      const pending = useMcpStore.getState().testStdioConnection({ transport: 'stdio' })

      expect(useMcpStore.getState().testingEndpoint).toBe('stdio')

      resolveInvocation([])
      await pending
    })

    it('records stdio test failures', async () => {
      mockInvoke.mockRejectedValue(new Error('spawn failed'))

      await expect(
        useMcpStore.getState().testStdioConnection({ transport: 'stdio', command: 'uvx' })
      ).rejects.toThrow('spawn failed')

      const state = useMcpStore.getState()
      expect(state.testError).toContain('spawn failed')
      expect(state.testingEndpoint).toBeNull()
      expect(state.testResult).toBeNull()
    })
  })

  describe('listServerTools', () => {
    it('returns the tools listed by the backend', async () => {
      const tools: McpToolInfo[] = [{ name: 'tool-a' }, { name: 'tool-b' }]
      mockInvoke.mockResolvedValue(tools)

      await expect(useMcpStore.getState().listServerTools('s1')).resolves.toEqual(tools)

      expect(mockInvoke).toHaveBeenCalledWith('list_mcp_server_tools', { id: 's1' })
    })

    it('rethrows listing failures without touching state', async () => {
      mockInvoke.mockRejectedValue(new Error('listing failed'))

      await expect(useMcpStore.getState().listServerTools('s1')).rejects.toThrow('listing failed')

      expect(useMcpStore.getState().error).toBeNull()
    })
  })

  describe('connectServer', () => {
    it('disconnects first and caches the listed tools once connected', async () => {
      const oldProbe: ProbeResult = { status: 'error', error: 'old probe' }
      useMcpStore.setState({
        connectionErrors: { s1: 'old failure' },
        probeResults: { s1: oldProbe },
      })
      let resolveTools!: (tools: McpToolInfo[]) => void
      dispatchInvoke({
        disconnect_mcp_server: () => undefined,
        list_mcp_server_tools: () =>
          new Promise<McpToolInfo[]>((resolve) => {
            resolveTools = resolve
          }),
      })

      const pending = useMcpStore.getState().connectServer('s1')

      expect(useMcpStore.getState().connectionStatus['s1']).toBe('connecting')
      expect(useMcpStore.getState().connectionErrors['s1']).toBeUndefined()

      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('list_mcp_server_tools', { id: 's1' })
      })
      resolveTools([{ name: 'tool-one' }])
      await pending

      expect(mockInvoke).toHaveBeenCalledWith('disconnect_mcp_server', { id: 's1' })
      expect(mockInvoke).toHaveBeenCalledWith('list_mcp_server_tools', { id: 's1' })
      const state = useMcpStore.getState()
      expect(state.connectionStatus['s1']).toBe('connected')
      expect(state.serverTools['s1']).toEqual([{ name: 'tool-one' }])
      expect(state.probeResults['s1']).toBeUndefined()
    })

    it('marks stdio servers as errored without probing on failure', async () => {
      useMcpStore.setState({
        servers: [
          createServer({
            id: 's1',
            config: JSON.stringify({ transport: 'stdio', command: 'uvx' }),
          }),
        ],
        serverTools: { s1: [{ name: 'stale' }] },
      })
      dispatchInvoke({
        disconnect_mcp_server: () => {
          throw new Error('spawn failed')
        },
      })

      await useMcpStore.getState().connectServer('s1')

      const state = useMcpStore.getState()
      expect(state.connectionStatus['s1']).toBe('error')
      expect(state.connectionErrors['s1']).toContain('spawn failed')
      expect(state.serverTools['s1']).toBeUndefined()
      expect(mockInvoke).not.toHaveBeenCalledWith('probe_mcp_endpoint', expect.anything())
    })

    it('probes http servers after a failed connection and reflects oauth requirements', async () => {
      useMcpStore.setState({ servers: [createServer({ id: 's1' })] })
      dispatchInvoke({
        disconnect_mcp_server: () => {
          throw new Error('401')
        },
        probe_mcp_endpoint: () => ({ status: 'needs_oauth' }),
      })

      await useMcpStore.getState().connectServer('s1')

      expect(mockInvoke).toHaveBeenCalledWith('probe_mcp_endpoint', { serverId: 's1' })
      const state = useMcpStore.getState()
      expect(state.probeResults['s1']).toEqual({ status: 'needs_oauth' })
      expect(state.connectionStatus['s1']).toBe('needs_auth')
      expect(state.connectionErrors['s1']).toContain('401')
    })
  })

  describe('probeEndpoint', () => {
    it('stores successful probe results without overriding a non-oauth status', async () => {
      useMcpStore.setState({ connectionStatus: { s1: 'error' } })
      const result: ProbeResult = {
        status: 'unauthorized',
        authorization_server_url: 'https://auth',
      }
      mockInvoke.mockResolvedValue(result)

      await expect(useMcpStore.getState().probeEndpoint('s1')).resolves.toEqual(result)

      const state = useMcpStore.getState()
      expect(state.probeResults['s1']).toEqual(result)
      expect(state.connectionStatus['s1']).toBe('error')
    })

    it('marks the server as needing auth when oauth discovery succeeds', async () => {
      mockInvoke.mockResolvedValue({ status: 'needs_oauth' })

      await useMcpStore.getState().probeEndpoint('s1')

      expect(useMcpStore.getState().connectionStatus['s1']).toBe('needs_auth')
      expect(useMcpStore.getState().probeResults['s1']).toEqual({ status: 'needs_oauth' })
    })

    it('returns and stores an error result when the probe rejects', async () => {
      mockInvoke.mockRejectedValue(new Error('network unreachable'))

      const result = await useMcpStore.getState().probeEndpoint('s1')

      expect(result).toEqual({
        status: 'error',
        error: expect.stringContaining('network unreachable'),
      })
      expect(useMcpStore.getState().probeResults['s1']).toEqual(result)
    })
  })

  describe('getConnectionStatus', () => {
    it('defaults to idle for unknown servers', () => {
      expect(useMcpStore.getState().getConnectionStatus('unknown')).toBe('idle')
    })

    it('returns the tracked status', () => {
      useMcpStore.setState({ connectionStatus: { s1: 'needs_auth' } })

      expect(useMcpStore.getState().getConnectionStatus('s1')).toBe('needs_auth')
    })
  })

  describe('getServerToolsCached', () => {
    it('returns cached tools for a connected server', () => {
      useMcpStore.setState({ serverTools: { s1: [{ name: 't' }] } })

      expect(useMcpStore.getState().getServerToolsCached('s1')).toEqual([{ name: 't' }])
    })

    it('returns an empty list when nothing is cached', () => {
      expect(useMcpStore.getState().getServerToolsCached('unknown')).toEqual([])
    })
  })

  describe('loadServers auto-connect', () => {
    it('reconnects enabled servers that are idle, errored or need auth but skips connected ones', async () => {
      const servers = [
        createServer({ id: 'fresh', is_enabled: true }),
        createServer({ id: 'disabled', is_enabled: false }),
        createServer({ id: 'ready', is_enabled: true }),
        createServer({ id: 'stale', is_enabled: true }),
        createServer({ id: 'builtin-ish', type: 'builtin', is_enabled: true }),
      ]
      useMcpStore.setState({
        connectionStatus: { ready: 'connected', stale: 'error', fresh: 'needs_auth' },
      })
      dispatchInvoke({
        list_mcp_servers: () => servers,
        disconnect_mcp_server: () => undefined,
        list_mcp_server_tools: () => [{ name: 't' }],
      })

      await useMcpStore.getState().loadServers()
      await vi.waitFor(() => {
        expect(useMcpStore.getState().connectionStatus['fresh']).toBe('connected')
        expect(useMcpStore.getState().connectionStatus['stale']).toBe('connected')
      })

      const disconnectIds = mockInvoke.mock.calls
        .filter(([cmd]) => cmd === 'disconnect_mcp_server')
        .map(([, args]) => {
          if (args && typeof args === 'object' && 'id' in args && typeof args.id === 'string') {
            return args.id
          }
          return ''
        })
        .filter(Boolean)
        .sort()
      expect(disconnectIds).toEqual(['fresh', 'stale'])
      expect(useMcpStore.getState().connectionStatus['ready']).toBe('connected')
      expect(useMcpStore.getState().connectionStatus['disabled']).toBeUndefined()
      expect(useMcpStore.getState().connectionStatus['builtin-ish']).toBeUndefined()
    })
  })

  describe('startOAuth', () => {
    it('opens the authorization url and stores the completed server', async () => {
      const initial = createServer({ id: 's1' })
      const completed = createServer({ id: 's1', auth_token: 'oauth-json' })
      useMcpStore.setState({ servers: [initial] })
      dispatchInvoke({
        start_mcp_oauth: () => ({
          auth_url: 'https://auth.example',
          redirect_uri: 'http://localhost/cb',
        }),
        complete_mcp_oauth: () => completed,
      })
      mockOpenUrl.mockResolvedValue(undefined)

      const result = await useMcpStore.getState().startOAuth('s1')

      expect(mockInvoke).toHaveBeenCalledWith('start_mcp_oauth', { serverId: 's1' })
      expect(mockOpenUrl).toHaveBeenCalledWith('https://auth.example')
      expect(mockInvoke).toHaveBeenCalledWith('complete_mcp_oauth', { serverId: 's1' })
      expect(result).toEqual(completed)
      expect(useMcpStore.getState().servers[0]).toEqual(completed)
    })

    it('propagates failures without opening a browser or changing the stored server', async () => {
      const initial = createServer({ id: 's1' })
      useMcpStore.setState({ servers: [initial] })
      mockInvoke.mockRejectedValue(new Error('oauth denied'))

      await expect(useMcpStore.getState().startOAuth('s1')).rejects.toThrow('oauth denied')

      expect(mockOpenUrl).not.toHaveBeenCalled()
      expect(useMcpStore.getState().servers).toEqual([initial])
    })
  })

  describe('checkOAuthStatus', () => {
    it('returns the backend status', async () => {
      const status: OAuthStatusResult = { is_authorized: true, token_expires_at: 1893456000 }
      mockInvoke.mockResolvedValue(status)

      await expect(useMcpStore.getState().checkOAuthStatus('s1')).resolves.toEqual(status)

      expect(mockInvoke).toHaveBeenCalledWith('check_mcp_oauth_status', { serverId: 's1' })
    })
  })

  describe('revokeOAuth', () => {
    it('revokes the token and reloads the server list', async () => {
      useMcpStore.setState({ servers: [createServer({ id: 's1' })] })
      const reloaded = [createServer({ id: 'other', is_enabled: false })]
      dispatchInvoke({
        revoke_mcp_oauth: () => undefined,
        list_mcp_servers: () => reloaded,
      })

      await useMcpStore.getState().revokeOAuth('s1')

      expect(mockInvoke).toHaveBeenCalledWith('revoke_mcp_oauth', { serverId: 's1' })
      expect(mockInvoke).toHaveBeenCalledWith('list_mcp_servers')
      expect(useMcpStore.getState().servers).toEqual(reloaded)
    })
  })

  describe('setBearerToken', () => {
    it('stores the bearer token in the backend', async () => {
      mockInvoke.mockResolvedValue(undefined)

      await useMcpStore.getState().setBearerToken('s1', 'secret-token')

      expect(mockInvoke).toHaveBeenCalledWith('set_mcp_bearer_token', {
        serverId: 's1',
        token: 'secret-token',
      })
    })
  })
})
