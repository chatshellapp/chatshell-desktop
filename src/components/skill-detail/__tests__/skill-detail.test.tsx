import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SkillDetail } from '../index'
import { useSkillStore } from '@/stores/skillStore'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import type { Skill } from '@/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count !== undefined ? `${key}:${String(options.count)}` : key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/components/skill-edit-dialog', () => ({
  SkillEditDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="skill-edit-dialog" /> : null,
}))

const actions = {
  toggleSkill: vi.fn(),
  openSkillFolder: vi.fn(),
  deleteSkill: vi.fn(),
}
vi.mock('@/hooks/useSkills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSkills')>()
  return { ...actual, useSkillActions: () => actions }
})

const NOW = '2026-01-01T00:00:00Z'
const own: Skill = {
  id: 's-1',
  name: 'notes',
  description: 'Take notes',
  source: 'user',
  path: 'notes',
  local_path: '/home/me/.chatshell/skills/notes',
  files_manifest: [
    { path: 'SKILL.md', hash: 'h1', size: 120, executable: false },
    { path: 'scripts/run.sh', hash: 'h2', size: 2048, executable: true },
  ],
  required_tool_ids: ['builtin-bash'],
  allow_model_invocation: true,
  allow_user_invocation: false,
  content_hash: 'c1',
  is_enabled: true,
  created_at: NOW,
  updated_at: NOW,
}
const external: Skill = {
  ...own,
  id: 's-2',
  name: 'pdf',
  source: 'claude',
  path: 'pdf',
  local_path: '/home/me/.claude/skills/pdf',
  files_manifest: [],
}

const readSkillContent = vi.fn()

const openMenu = () =>
  fireEvent.pointerDown(screen.getByRole('button', { name: 'moreActions' }), {
    button: 0,
    ctrlKey: false,
  })

describe('SkillDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readSkillContent.mockResolvedValue('---\nname: notes\n---\nWrite notes.')
    useSkillStore.setState({ readSkillContent } as never)
    useLibrarySelectionStore.setState({ selectedSkillId: 's-1' })
  })

  it('shows SKILL.md, details and files for a ChatShell skill', async () => {
    render(<SkillDetail skill={own} />)

    expect(screen.getByRole('heading', { name: 'notes' })).toBeInTheDocument()
    expect(screen.getByText('synced')).toBeInTheDocument()
    expect(await screen.findByText(/Write notes\./)).toBeInTheDocument()
    expect(readSkillContent).toHaveBeenCalledWith('s-1')
    expect(screen.getByText('builtin-bash')).toBeInTheDocument()
    expect(screen.getByText('scripts/run.sh')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
  })

  it('makes Edit primary for an enabled ChatShell skill and keeps Disable in the menu', async () => {
    render(<SkillDetail skill={own} />)

    expect(screen.queryByRole('button', { name: 'useInNewChat' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'disable' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    expect(screen.getByTestId('skill-edit-dialog')).toBeInTheDocument()

    openMenu()
    expect(screen.queryByRole('menuitem', { name: 'edit' })).toBeNull()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'disable' }))
    expect(actions.toggleSkill).toHaveBeenCalledWith(own)
    expect(screen.getByText('offeredYes')).toBeInTheDocument()
  })

  it('makes Open Folder primary for another agent\u2019s skill', () => {
    render(<SkillDetail skill={external} />)

    fireEvent.click(screen.getByRole('button', { name: 'openFolder' }))
    expect(actions.openSkillFolder).toHaveBeenCalledWith(external)
  })

  it('shows no primary button while a synced skill is still downloading', () => {
    render(<SkillDetail skill={{ ...own, local_path: undefined }} />)

    for (const name of ['edit', 'openFolder', 'enable', 'disable']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.getByRole('button', { name: 'moreActions' })).toBeInTheDocument()
  })

  it('offers Enable for a disabled skill and says why it is not offered', () => {
    const disabled = { ...own, is_enabled: false }
    render(<SkillDetail skill={disabled} />)

    fireEvent.click(screen.getByRole('button', { name: 'enable' }))
    expect(actions.toggleSkill).toHaveBeenCalledWith(disabled)
    expect(screen.getByText('offeredNoDisabled')).toBeInTheDocument()
  })

  it('flags a skill whose SKILL.md opts out of model invocation', () => {
    render(<SkillDetail skill={{ ...own, allow_model_invocation: false }} />)

    expect(screen.getByText('hiddenFromModel')).toBeInTheDocument()
    expect(screen.getByText('offeredNoOptOut')).toBeInTheDocument()
    expect(screen.queryByText('userInvocation')).toBeNull()
  })

  it('deletes ChatShell skills from the menu', async () => {
    actions.deleteSkill.mockResolvedValue(true)
    render(<SkillDetail skill={own} />)

    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'delete' }))

    await waitFor(() => expect(actions.deleteSkill).toHaveBeenCalledWith(own))
    await waitFor(() => expect(useLibrarySelectionStore.getState().selectedSkillId).toBeNull())
  })

  it('keeps other agents’ skills read-only and device-local', async () => {
    render(<SkillDetail skill={external} />)

    expect(screen.getByText('thisDeviceOnly')).toBeInTheDocument()
    expect(screen.getByText('readOnlyHint')).toBeInTheDocument()
    openMenu()
    expect(await screen.findByRole('menuitem', { name: 'disable' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'openFolder' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'edit' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'delete' })).toBeNull()
  })

  it('explains a synced skill whose files are still downloading', () => {
    render(<SkillDetail skill={{ ...own, local_path: undefined }} />)

    expect(screen.getByText('notOnThisDevice')).toBeInTheDocument()
    expect(screen.getByText('notOnThisDeviceDescription')).toBeInTheDocument()
    expect(readSkillContent).not.toHaveBeenCalled()
  })
})
