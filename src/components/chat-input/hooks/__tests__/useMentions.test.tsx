import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import i18n from '@/lib/i18n'
import { useMentions } from '../useMentions'
import type { Attachment } from '../../types'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

void i18n

describe('useMentions', () => {
  let input: string
  let attachments: Attachment[]
  const textarea = document.createElement('textarea')

  beforeEach(() => {
    vi.clearAllMocks()
    attachments = []
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mention_candidates') return ['docs/guide.md', 'src/main.rs']
      if (cmd === 'get_path_file_size') return 12
      if (cmd === 'read_text_file_from_path') return 'fn main() {}'
      return null
    })
  })

  function render(text: string, workingDirectory: string | null = '/work') {
    input = text
    textarea.value = text
    textarea.setSelectionRange(text.length, text.length)
    const setInput = vi.fn((next: string | ((prev: string) => string)) => {
      input = typeof next === 'function' ? next(input) : next
    })
    const hook = renderHook(() =>
      useMentions({
        input,
        setInput,
        textareaRef: { current: textarea },
        workingDirectory,
        setAttachments: (update) => {
          attachments = typeof update === 'function' ? update(attachments) : update
        },
        visionDisabled: false,
      })
    )
    act(() => hook.result.current.syncCaret())
    hook.rerender()
    return { hook, setInput }
  }

  it('lists ranked working-directory files for the typed query', async () => {
    const { hook } = render('look at @ma')
    await waitFor(() => expect(hook.result.current.mentionState?.loading).toBe(false))
    expect(invoke).toHaveBeenCalledWith('list_mention_candidates', { root: '/work' })
    expect(hook.result.current.mentionState?.matches).toEqual(['src/main.rs'])
  })

  it('picking inserts the path and attaches the file under its relative name', async () => {
    const { hook, setInput } = render('look at @ma')
    await waitFor(() => expect(hook.result.current.mentionState?.matches).toHaveLength(1))

    act(() => hook.result.current.pickMention('src/main.rs'))

    expect(setInput).toHaveBeenCalledWith('look at @src/main.rs ')
    await waitFor(() => expect(attachments).toHaveLength(1))
    expect(invoke).toHaveBeenCalledWith('read_text_file_from_path', { path: '/work/src/main.rs' })
    expect(attachments[0]).toMatchObject({ name: 'src/main.rs', content: 'fn main() {}' })
  })

  it('explains that a working directory is needed', () => {
    const { hook } = render('@x', null)
    expect(hook.result.current.mentionState?.noWorkingDirectory).toBe(true)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('is closed when the caret is not in a mention', () => {
    const { hook } = render('plain text')
    expect(hook.result.current.mentionState).toBeNull()
  })
})
