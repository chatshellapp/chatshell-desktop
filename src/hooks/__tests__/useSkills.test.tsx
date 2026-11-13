import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { toast } from 'sonner'
import { useSelectedSkill, useSkillActions } from '../useSkills'
import { useSkillStore } from '@/stores/skillStore'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import type { Skill } from '@/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const NOW = '2026-01-01T00:00:00Z'
const skill = (id: string, enabled = true): Skill => ({
  id,
  name: id,
  source: 'user',
  path: id,
  files_manifest: [],
  required_tool_ids: [],
  allow_model_invocation: true,
  allow_user_invocation: true,
  is_enabled: enabled,
  created_at: NOW,
  updated_at: NOW,
})

describe('useSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSkillStore.setState({ skills: [skill('a'), skill('b'), skill('off', false)] })
  })

  it('resolves the selected skill and drops a deleted one', () => {
    useLibrarySelectionStore.setState({ selectedSkillId: 'b' })
    const { result, rerender } = renderHook(() => useSelectedSkill())
    expect(result.current?.id).toBe('b')
    act(() => useSkillStore.setState({ skills: [skill('a')] }))
    rerender()
    expect(result.current).toBeNull()
  })

  it('toggles a skill and reports failures as a toast', async () => {
    const toggleSkill = vi.fn().mockRejectedValueOnce(new Error('db busy'))
    useSkillStore.setState({ toggleSkill } as never)
    const { result } = renderHook(() => useSkillActions())

    await act(() => result.current.toggleSkill(skill('a')))

    expect(toggleSkill).toHaveBeenCalledWith('a')
    expect(toast.error).toHaveBeenCalledWith('failedToToggleSkill', { description: 'db busy' })
  })

  it('reports deletes and returns whether they happened', async () => {
    const deleteSkill = vi.fn().mockResolvedValueOnce(undefined)
    useSkillStore.setState({ deleteSkill } as never)
    const { result } = renderHook(() => useSkillActions())

    let deleted = false
    await act(async () => {
      deleted = await result.current.deleteSkill(skill('a'))
    })

    expect(deleted).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('deleted')
  })
})
