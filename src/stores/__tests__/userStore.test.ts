import { invoke } from '@tauri-apps/api/core'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUserStore } from '../userStore'
import type { User } from '@/types'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const createMockUser = (id: string, username: string = 'tester'): User => ({
  id,
  username,
  display_name: username,
  avatar_type: 'text',
  is_self: true,
  status: 'online',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

const invokeMock = vi.mocked(invoke)

describe('useUserStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockResolvedValue(undefined)
    useUserStore.setState({
      selfUser: null,
      users: [],
      isLoading: false,
      error: null,
    })
  })

  describe('initial state', () => {
    it('starts with no self user, empty users, not loading and no error', () => {
      const state = useUserStore.getState()
      expect(state.selfUser).toBeNull()
      expect(state.users).toEqual([])
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })
  })

  describe('loadSelfUser', () => {
    it('loads the self user on success', async () => {
      const user = createMockUser('u-1', 'alice')
      invokeMock.mockResolvedValue(user)

      await useUserStore.getState().loadSelfUser()

      expect(invokeMock).toHaveBeenCalledWith('get_self_user')
      const state = useUserStore.getState()
      expect(state.selfUser).toEqual(user)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('keeps selfUser null when backend returns null', async () => {
      invokeMock.mockResolvedValue(null)

      await useUserStore.getState().loadSelfUser()

      const state = useUserStore.getState()
      expect(state.selfUser).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('stores the error message when invoke rejects', async () => {
      invokeMock.mockRejectedValue(new Error('backend down'))

      await useUserStore.getState().loadSelfUser()

      const state = useUserStore.getState()
      expect(state.selfUser).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('Error: backend down')
    })
  })

  describe('loadUsers', () => {
    it('loads the user list on success', async () => {
      const users = [createMockUser('u-1', 'alice'), createMockUser('u-2', 'bob')]
      invokeMock.mockResolvedValue(users)

      await useUserStore.getState().loadUsers()

      expect(invokeMock).toHaveBeenCalledWith('list_users')
      const state = useUserStore.getState()
      expect(state.users).toEqual(users)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('replaces a previous error with null on a later success', async () => {
      useUserStore.setState({ error: 'old error' })
      invokeMock.mockResolvedValue([])

      await useUserStore.getState().loadUsers()

      expect(useUserStore.getState().error).toBeNull()
      expect(useUserStore.getState().users).toEqual([])
    })

    it('stores the error message when invoke rejects', async () => {
      invokeMock.mockRejectedValue(new Error('no db'))

      await useUserStore.getState().loadUsers()

      const state = useUserStore.getState()
      expect(state.users).toEqual([])
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('Error: no db')
    })
  })

  describe('getSelfUserId', () => {
    it('returns null when no self user is loaded', () => {
      expect(useUserStore.getState().getSelfUserId()).toBeNull()
    })

    it('returns the self user id after loading', async () => {
      invokeMock.mockResolvedValue(createMockUser('u-42', 'carol'))

      await useUserStore.getState().loadSelfUser()

      expect(useUserStore.getState().getSelfUserId()).toBe('u-42')
    })
  })
})
