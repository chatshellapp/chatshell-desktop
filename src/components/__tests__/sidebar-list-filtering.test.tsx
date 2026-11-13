import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModelList, type ModelVendor } from '@/components/model-list'
import { AssistantList, type AssistantGroup } from '@/components/assistant-list'
import { PromptList, type PromptGroup } from '@/components/prompt-list'
import { ContactsContent } from '@/components/sidebar/contacts-content'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

// The second group is collapsed by default (a starred item exists), so its
// match is only visible when filtering opens every group.
const vendors: ModelVendor[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [{ id: 'm-1', name: 'gpt-5', modelId: 'openai/gpt-5', isStarred: true }],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [{ id: 'm-2', name: 'claude-haiku', modelId: 'anthropic/claude-haiku' }],
  },
]
const assistantGroups: AssistantGroup[] = [
  { id: 'g-1', name: 'Work', assistants: [{ id: 'a-1', name: 'Reviewer', isStarred: true }] },
  { id: 'g-2', name: 'Home', assistants: [{ id: 'a-2', name: 'Chef' }] },
]
const promptGroups: PromptGroup[] = [
  {
    id: 'c-1',
    name: 'Writing',
    prompts: [{ id: 'p-1', name: 'Summarize', content: 'x', isStarred: true }],
  },
  { id: 'c-2', name: 'Code', prompts: [{ id: 'p-2', name: 'Refactor', content: 'y' }] },
]

describe('sidebar lists in filtering mode', () => {
  it('ModelList opens every vendor and hides the Starred group', () => {
    const { rerender } = render(<ModelList vendors={vendors} />)
    expect(screen.getByText('starred')).toBeInTheDocument()
    expect(screen.queryByText('claude-haiku')).toBeNull()

    rerender(<ModelList vendors={vendors} filtering />)
    expect(screen.queryByText('starred')).toBeNull()
    expect(screen.getByText('claude-haiku')).toBeInTheDocument()
    expect(screen.getAllByText('gpt-5')).toHaveLength(1)
  })

  it('AssistantList opens every group and hides the Starred group', () => {
    const { rerender } = render(<AssistantList groups={assistantGroups} />)
    expect(screen.queryByText('Chef')).toBeNull()

    rerender(<AssistantList groups={assistantGroups} filtering />)
    expect(screen.queryByText('starred')).toBeNull()
    expect(screen.getByText('Chef')).toBeInTheDocument()
  })

  it('PromptList opens every group and hides the Starred group', () => {
    const { rerender } = render(<PromptList groups={promptGroups} />)
    expect(screen.queryByText('Refactor')).toBeNull()

    rerender(<PromptList groups={promptGroups} filtering />)
    expect(screen.queryByText('starred')).toBeNull()
    expect(screen.getByText('Refactor')).toBeInTheDocument()
  })

  it('restores the normal group state when the filter clears', () => {
    const { rerender } = render(<PromptList groups={promptGroups} filtering />)
    rerender(<PromptList groups={promptGroups} />)
    expect(screen.getByText('starred')).toBeInTheDocument()
    expect(screen.queryByText('Refactor')).toBeNull()
  })
})

describe('ContactsContent with an active filter', () => {
  const noop = vi.fn()
  const props = {
    onTabChange: noop,
    onModelClick: noop,
    onModelActivate: noop,
    onModelSettings: noop,
    onModelDelete: noop,
    onModelStarToggle: noop,
    onVendorSettings: noop,
    onAssistantClick: noop,
    onAssistantActivate: noop,
    onAssistantSettings: noop,
    onAssistantStarToggle: noop,
    onAssistantDelete: noop,
    onGroupRename: noop,
  }

  it('says "no matches" instead of the add-a-provider empty state', () => {
    render(
      <ContactsContent
        {...props}
        activeTab="models"
        vendorsList={[]}
        assistantGroups={[]}
        filterActive
      />
    )
    expect(screen.getByText('noMatches')).toBeInTheDocument()
    expect(screen.queryByText('addYourFirstProvider')).toBeNull()
  })

  it('keeps the real empty state when no filter is active', () => {
    render(<ContactsContent {...props} activeTab="models" vendorsList={[]} assistantGroups={[]} />)
    expect(screen.queryByText('noMatches')).toBeNull()
    expect(screen.getByText('addYourFirstProvider')).toBeInTheDocument()
  })
})
