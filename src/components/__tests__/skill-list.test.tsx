import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SkillList } from '../skill-list'
import type { Skill } from '@/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

const NOW = '2026-01-01T00:00:00Z'
const skill = (id: string, name: string, source: string, extra: Partial<Skill> = {}): Skill => ({
  id,
  name,
  source,
  path: name,
  local_path: `/s/${name}`,
  files_manifest: [],
  required_tool_ids: [],
  allow_model_invocation: true,
  allow_user_invocation: true,
  is_enabled: true,
  created_at: NOW,
  updated_at: NOW,
  ...extra,
})

const skills = [
  skill('b', 'installer', 'builtin'),
  skill('c', 'pdf', 'claude', { description: 'Read PDFs' }),
  skill('u', 'notes', 'user', { is_enabled: false }),
]

function setup() {
  const props = {
    onSkillClick: vi.fn(),
    onSkillToggle: vi.fn(),
  }
  render(<SkillList skills={skills} selectedSkillId="c" {...props} />)
  return props
}

const item = (name: string) => screen.getByText(name).closest('[role="button"]') as HTMLElement

describe('SkillList', () => {
  it('groups by source with ChatShell skills first', () => {
    setup()
    const headers = screen
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((text) => text.startsWith('sourceLabels.'))
    expect(headers).toEqual(['sourceLabels.user1', 'sourceLabels.builtin1', 'sourceLabels.claude1'])
    expect(screen.getByText('disabled')).toBeInTheDocument()
  })

  it('opens the detail page on click, Enter or Space; double-click does nothing extra', () => {
    const props = setup()
    fireEvent.click(item('pdf'))
    fireEvent.keyDown(item('installer'), { key: 'Enter' })
    fireEvent.keyDown(item('notes'), { key: ' ' })
    fireEvent.doubleClick(item('pdf'))

    expect(props.onSkillClick.mock.calls.map(([s]) => s.id)).toEqual(['c', 'b', 'u'])
    expect(screen.queryByText('useInNewChat')).toBeNull()
  })

  it('marks the selected skill', () => {
    setup()
    const classes = (name: string) => item(name).className.split(/\s+/)
    expect(classes('pdf')).toContain('bg-accent')
    expect(classes('notes')).not.toContain('bg-accent')
  })
})
