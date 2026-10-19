import { invoke } from '@tauri-apps/api/core'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSkillStore } from '../skillStore'
import type { Skill, SkillSourceInfo } from '@/types'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
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

const createMockSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-1',
  name: 'pdf-reader',
  description: 'Read PDF documents',
  source: 'builtin',
  path: '/skills/pdf-reader',
  required_tool_ids: [],
  allow_model_invocation: true,
  allow_user_invocation: true,
  is_enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const createMockSource = (overrides: Partial<SkillSourceInfo> = {}): SkillSourceInfo => ({
  source: 'user',
  path: '/home/user/.chatshell/skills',
  enabled: true,
  always_on: false,
  exists: true,
  ...overrides,
})

describe('useSkillStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSkillStore.setState({
      skills: [],
      sources: [],
      isLoading: false,
      error: null,
      hasScanned: false,
    })
  })

  describe('loadSkills', () => {
    it('stores skills returned by list_skills and stops loading', async () => {
      const skills = [createMockSkill(), createMockSkill({ id: 'skill-2' })]
      mockInvoke.mockResolvedValueOnce(skills)

      await useSkillStore.getState().loadSkills()

      expect(mockInvoke).toHaveBeenCalledWith('list_skills')
      const state = useSkillStore.getState()
      expect(state.skills).toEqual(skills)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('replaces stale skills so the list stays in sync with the backend', async () => {
      useSkillStore.setState({ skills: [createMockSkill({ id: 'stale' })] })
      mockInvoke.mockResolvedValueOnce([createMockSkill({ id: 'fresh' })])

      await useSkillStore.getState().loadSkills()

      expect(useSkillStore.getState().skills.map((s) => s.id)).toEqual(['fresh'])
    })

    it('stores the error and stops loading when invoke fails', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('index corrupt'))

      await useSkillStore.getState().loadSkills()

      const state = useSkillStore.getState()
      expect(state.error).toBe('Error: index corrupt')
      expect(state.isLoading).toBe(false)
      expect(state.skills).toEqual([])
    })

    it('does not mark hasScanned', async () => {
      mockInvoke.mockResolvedValueOnce([createMockSkill()])

      await useSkillStore.getState().loadSkills()

      expect(useSkillStore.getState().hasScanned).toBe(false)
    })
  })

  describe('scanSkills', () => {
    it('stores scanned skills, marks hasScanned and refreshes sources', async () => {
      const scanned = [createMockSkill({ id: 'scanned-1' })]
      const sources = [createMockSource()]
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'scan_skills') return scanned
        if (cmd === 'get_skill_sources') return sources
        throw new Error(`unexpected command: ${cmd}`)
      })

      await useSkillStore.getState().scanSkills()

      const state = useSkillStore.getState()
      expect(mockInvoke).toHaveBeenCalledWith('scan_skills')
      expect(mockInvoke).toHaveBeenCalledWith('get_skill_sources')
      expect(state.skills).toEqual(scanned)
      expect(state.sources).toEqual(sources)
      expect(state.hasScanned).toBe(true)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('stores the error without throwing when the scan fails', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('scan permission denied'))

      await useSkillStore.getState().scanSkills()

      const state = useSkillStore.getState()
      expect(state.error).toBe('Error: scan permission denied')
      expect(state.isLoading).toBe(false)
      expect(state.hasScanned).toBe(false)
      expect(state.skills).toEqual([])
    })
  })

  describe('ensureLoaded', () => {
    it('scans when the store is empty, idle and never scanned', async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'scan_skills') return [createMockSkill()]
        if (cmd === 'get_skill_sources') return []
        throw new Error(`unexpected command: ${cmd}`)
      })

      await useSkillStore.getState().ensureLoaded()

      expect(mockInvoke).toHaveBeenCalledWith('scan_skills')
      expect(useSkillStore.getState().hasScanned).toBe(true)
    })

    it('skips scanning when skills are already present', async () => {
      useSkillStore.setState({ skills: [createMockSkill()] })

      await useSkillStore.getState().ensureLoaded()

      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('skips scanning after a scan already happened even if it found nothing', async () => {
      useSkillStore.setState({ hasScanned: true })

      await useSkillStore.getState().ensureLoaded()

      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('skips scanning while another load is in flight', async () => {
      useSkillStore.setState({ isLoading: true })

      await useSkillStore.getState().ensureLoaded()

      expect(mockInvoke).not.toHaveBeenCalled()
      expect(useSkillStore.getState().isLoading).toBe(true)
    })
  })

  describe('deleteSkill', () => {
    it('removes the skill from the list after a successful delete', async () => {
      useSkillStore.setState({
        skills: [createMockSkill({ id: 'skill-a' }), createMockSkill({ id: 'skill-b' })],
      })
      mockInvoke.mockResolvedValueOnce(null)

      await useSkillStore.getState().deleteSkill('skill-a')

      expect(mockInvoke).toHaveBeenCalledWith('delete_skill', { id: 'skill-a' })
      expect(useSkillStore.getState().skills.map((s) => s.id)).toEqual(['skill-b'])
    })

    it('propagates the error and keeps the skill', async () => {
      useSkillStore.setState({ skills: [createMockSkill({ id: 'skill-a' })] })
      mockInvoke.mockRejectedValueOnce(new Error('file in use'))

      await expect(useSkillStore.getState().deleteSkill('skill-a')).rejects.toThrow('file in use')

      expect(useSkillStore.getState().skills).toHaveLength(1)
      // deleteSkill does not manage the error field
      expect(useSkillStore.getState().error).toBeNull()
    })
  })

  describe('toggleSkill', () => {
    it('replaces the skill with the backend version and returns it', async () => {
      useSkillStore.setState({
        skills: [
          createMockSkill({ id: 'skill-a', is_enabled: true }),
          createMockSkill({ id: 'skill-b' }),
        ],
      })
      const toggled = createMockSkill({ id: 'skill-a', is_enabled: false })
      mockInvoke.mockResolvedValueOnce(toggled)

      const result = await useSkillStore.getState().toggleSkill('skill-a')

      expect(mockInvoke).toHaveBeenCalledWith('toggle_skill', { id: 'skill-a' })
      expect(result.is_enabled).toBe(false)
      const state = useSkillStore.getState()
      expect(state.skills[0].is_enabled).toBe(false)
      // Sibling skill is untouched
      expect(state.skills[1].is_enabled).toBe(true)
    })

    it('leaves the list unchanged when the id is unknown', async () => {
      const existing = [createMockSkill({ id: 'skill-a' })]
      useSkillStore.setState({ skills: existing })
      mockInvoke.mockResolvedValueOnce(createMockSkill({ id: 'ghost', is_enabled: false }))

      await useSkillStore.getState().toggleSkill('ghost')

      expect(useSkillStore.getState().skills).toEqual(existing)
    })

    it('propagates the error and keeps the skill unchanged', async () => {
      useSkillStore.setState({
        skills: [createMockSkill({ id: 'skill-a', is_enabled: true })],
      })
      mockInvoke.mockRejectedValueOnce(new Error('toggle failed'))

      await expect(useSkillStore.getState().toggleSkill('skill-a')).rejects.toThrow('toggle failed')

      expect(useSkillStore.getState().skills[0].is_enabled).toBe(true)
    })
  })

  describe('setAllEnabled', () => {
    it('replaces the list with the backend response for enabled', async () => {
      useSkillStore.setState({ skills: [createMockSkill({ is_enabled: false })] })
      const enabled = [
        createMockSkill({ id: 'skill-1', is_enabled: true }),
        createMockSkill({ id: 'skill-2', is_enabled: true }),
      ]
      mockInvoke.mockResolvedValueOnce(enabled)

      await useSkillStore.getState().setAllEnabled(true)

      expect(mockInvoke).toHaveBeenCalledWith('set_all_skills_enabled', {
        enabled: true,
      })
      expect(useSkillStore.getState().skills).toEqual(enabled)
    })

    it('replaces the list with the backend response for disabled', async () => {
      mockInvoke.mockResolvedValueOnce([createMockSkill({ id: 'skill-1', is_enabled: false })])

      await useSkillStore.getState().setAllEnabled(false)

      expect(mockInvoke).toHaveBeenCalledWith('set_all_skills_enabled', {
        enabled: false,
      })
      expect(useSkillStore.getState().skills[0].is_enabled).toBe(false)
    })

    it('propagates the error and keeps the previous list', async () => {
      useSkillStore.setState({ skills: [createMockSkill()] })
      mockInvoke.mockRejectedValueOnce(new Error('bulk update failed'))

      await expect(useSkillStore.getState().setAllEnabled(true)).rejects.toThrow(
        'bulk update failed'
      )

      expect(useSkillStore.getState().skills).toHaveLength(1)
    })
  })

  describe('readSkillContent', () => {
    it('returns the content without touching store state', async () => {
      mockInvoke.mockResolvedValueOnce('# My skill instructions')

      const content = await useSkillStore.getState().readSkillContent('/skills/pdf-reader/SKILL.md')

      expect(mockInvoke).toHaveBeenCalledWith('read_skill_content', {
        path: '/skills/pdf-reader/SKILL.md',
      })
      expect(content).toBe('# My skill instructions')
      const state = useSkillStore.getState()
      expect(state.skills).toEqual([])
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('propagates the error when the file cannot be read', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('file not found'))

      await expect(useSkillStore.getState().readSkillContent('/missing/SKILL.md')).rejects.toThrow(
        'file not found'
      )
    })
  })

  describe('getSkillById', () => {
    it('returns the skill with the matching id', () => {
      const target = createMockSkill({ id: 'skill-b' })
      useSkillStore.setState({
        skills: [createMockSkill({ id: 'skill-a' }), target],
      })

      expect(useSkillStore.getState().getSkillById('skill-b')).toEqual(target)
    })

    it('returns undefined for an unknown id', () => {
      useSkillStore.setState({ skills: [createMockSkill()] })

      expect(useSkillStore.getState().getSkillById('nope')).toBeUndefined()
    })
  })

  describe('loadSources', () => {
    it('stores the sources returned by get_skill_sources', async () => {
      const sources = [
        createMockSource({ source: 'builtin' }),
        createMockSource({ source: 'user', enabled: false }),
      ]
      mockInvoke.mockResolvedValueOnce(sources)

      await useSkillStore.getState().loadSources()

      expect(mockInvoke).toHaveBeenCalledWith('get_skill_sources')
      expect(useSkillStore.getState().sources).toEqual(sources)
    })

    it('swallows errors without setting the error field', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('sources unavailable'))

      await useSkillStore.getState().loadSources()

      const state = useSkillStore.getState()
      expect(state.error).toBeNull()
      expect(state.sources).toEqual([])
    })
  })

  describe('setSourceEnabled', () => {
    it('updates the source locally and rescans skills', async () => {
      useSkillStore.setState({
        sources: [
          createMockSource({ source: 'builtin', enabled: true }),
          createMockSource({ source: 'user', enabled: true }),
        ],
      })
      const rescanned = [createMockSkill({ id: 'rescanned-1' })]
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'set_skill_source_enabled') return null
        if (cmd === 'scan_skills') return rescanned
        if (cmd === 'get_skill_sources') {
          return [
            createMockSource({ source: 'builtin', enabled: true }),
            createMockSource({ source: 'user', enabled: false }),
          ]
        }
        throw new Error(`unexpected command: ${cmd}`)
      })

      await useSkillStore.getState().setSourceEnabled('user', false)

      expect(mockInvoke).toHaveBeenCalledWith('set_skill_source_enabled', {
        source: 'user',
        enabled: false,
      })
      const state = useSkillStore.getState()
      expect(state.sources.find((s) => s.source === 'user')?.enabled).toBe(false)
      expect(state.skills).toEqual(rescanned)
      expect(state.hasScanned).toBe(true)
    })

    it('keeps the local update even when the follow-up source fetch fails', async () => {
      useSkillStore.setState({
        sources: [createMockSource({ source: 'user', enabled: true })],
      })
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'set_skill_source_enabled') return null
        if (cmd === 'scan_skills') return []
        throw new Error('sources unavailable')
      })

      await useSkillStore.getState().setSourceEnabled('user', false)

      expect(useSkillStore.getState().sources[0].enabled).toBe(false)
      expect(useSkillStore.getState().error).toBeNull()
    })

    it('resyncs sources from the backend after rescanning for an unknown source', async () => {
      useSkillStore.setState({
        sources: [createMockSource({ source: 'user', enabled: true })],
      })
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'set_skill_source_enabled') return null
        if (cmd === 'scan_skills') return [createMockSkill()]
        if (cmd === 'get_skill_sources') {
          return [createMockSource({ source: 'user', enabled: true })]
        }
        throw new Error(`unexpected command: ${cmd}`)
      })

      await useSkillStore.getState().setSourceEnabled('ghost', false)

      const state = useSkillStore.getState()
      expect(state.sources).toHaveLength(1)
      expect(state.sources[0].enabled).toBe(true)
      expect(state.hasScanned).toBe(true)
    })

    it('propagates the error when the backend rejects the change', async () => {
      useSkillStore.setState({
        sources: [createMockSource({ source: 'user', enabled: true })],
      })
      mockInvoke.mockRejectedValueOnce(new Error('source read-only'))

      await expect(useSkillStore.getState().setSourceEnabled('user', false)).rejects.toThrow(
        'source read-only'
      )

      expect(useSkillStore.getState().sources[0].enabled).toBe(true)
      expect(mockInvoke).toHaveBeenCalledTimes(1)
    })
  })
})
