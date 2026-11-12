import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PromptList, type PromptGroup } from '@/components/prompt-list'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

const groups: PromptGroup[] = [
  {
    id: 'category:Writing',
    name: 'Writing',
    defaultOpen: true,
    prompts: [{ id: 'p-1', name: 'Summarize', content: 'text', isStarred: true }],
  },
  {
    id: 'category:Uncategorized',
    name: 'Uncategorized',
    defaultOpen: true,
    prompts: [{ id: 'p-2', name: 'Loose', content: 'text' }],
  },
]

const menuButtons = () =>
  screen
    .getAllByRole('button')
    .filter((button) => button.closest('.group\\/group-header') && !button.textContent)

const openMenu = (button: HTMLElement) =>
  fireEvent.pointerDown(button, { button: 0, ctrlKey: false })

describe('PromptList', () => {
  it('localizes the starred and uncategorized group names', () => {
    render(<PromptList groups={groups} onGroupRename={vi.fn()} />)

    expect(screen.getByText('starred')).toBeInTheDocument()
    expect(screen.getByText('uncategorized')).toBeInTheDocument()
  })

  it('shows a category menu only for real categories', () => {
    render(<PromptList groups={groups} onGroupRename={vi.fn()} />)

    // Starred and Uncategorized are virtual buckets without a menu
    expect(menuButtons()).toHaveLength(1)
  })

  it('hides category menus without a rename handler', () => {
    render(<PromptList groups={groups} />)

    expect(menuButtons()).toHaveLength(0)
  })

  it('removes a category through the menu', () => {
    const onGroupRename = vi.fn()
    render(<PromptList groups={groups} onGroupRename={onGroupRename} />)

    openMenu(menuButtons()[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'uncategorizePrompts' }))

    expect(onGroupRename).toHaveBeenCalledWith(groups[0], '')
  })

  it('renames a category through the dialog', () => {
    const onGroupRename = vi.fn()
    render(<PromptList groups={groups} onGroupRename={onGroupRename} />)

    openMenu(menuButtons()[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'renameCategory' }))
    const input = screen.getByDisplayValue('Writing')
    fireEvent.change(input, { target: { value: 'Drafting' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onGroupRename).toHaveBeenCalledWith(groups[0], 'Drafting')
  })
})
