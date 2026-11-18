import { describe, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UserPromptQuickSelectDialog } from '../UserPromptQuickSelectDialog'
import { usePromptStore } from '@/stores/promptStore'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

const servers = [
  {
    server_id: 's1',
    server_name: 'GitHub',
    prompts: [
      { name: 'summary', title: 'Repo summary', arguments: [] },
      {
        name: 'review',
        title: 'Code review',
        description: 'Review a pull request',
        arguments: [{ name: 'pr', title: 'Pull request', required: true }],
      },
    ],
  },
]

function setup(onSelectPrompt = vi.fn(), onOpenChange = vi.fn()) {
  render(
    <UserPromptQuickSelectDialog
      isOpen
      onOpenChange={onOpenChange}
      onSelectPrompt={onSelectPrompt}
      mcpServerIds={['s1']}
    />
  )
  return { onSelectPrompt, onOpenChange }
}

describe('UserPromptQuickSelectDialog — MCP prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePromptStore.setState({ prompts: [], ensureLoaded: vi.fn() } as never)
    invoke.mockImplementation((command: string, args: Record<string, unknown>) => {
      if (command === 'list_mcp_prompts') return Promise.resolve(servers)
      if (command === 'get_mcp_prompt') {
        const values = args.arguments as Record<string, string>
        return Promise.resolve(
          args.name === 'review' ? `Review PR ${values.pr}` : 'Summarize the repository'
        )
      }
      return Promise.resolve(null)
    })
  })

  it('lists the chat servers’ prompts in their own group', async () => {
    setup()
    expect(await screen.findByText('MCP · GitHub')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('list_mcp_prompts', { serverIds: ['s1'] })
    expect(screen.getByText('Repo summary')).toBeInTheDocument()
    expect(screen.getByText('Code review')).toBeInTheDocument()
  })

  it('inserts a prompt without arguments directly', async () => {
    const { onSelectPrompt, onOpenChange } = setup()
    fireEvent.click(await screen.findByText('Repo summary'))
    await waitFor(() =>
      expect(onSelectPrompt).toHaveBeenCalledWith('mcp:s1/summary', 'Summarize the repository')
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('asks for required arguments before inserting', async () => {
    const { onSelectPrompt } = setup()
    fireEvent.click(await screen.findByText('Code review'))
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Pull request')
    expect(onSelectPrompt).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/Pull request/), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    await waitFor(() =>
      expect(onSelectPrompt).toHaveBeenCalledWith('mcp:s1/review', 'Review PR 42')
    )
    expect(invoke).toHaveBeenCalledWith('get_mcp_prompt', {
      serverId: 's1',
      name: 'review',
      arguments: { pr: '42' },
    })
  })
})
