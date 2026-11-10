import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '@/lib/i18n'
import { RENDER_OPENUI_BLOCKS_SETTING } from '@/lib/openui/settings'
import { useSettingsStore } from '@/stores/settingsStore'
import { MarkdownContent } from '../index'
import { MarkdownStreamingContext } from '../streaming-context'

void i18n

// A renderer that crashes on a half-written program, the way a component can
// when a streamed argument is still incomplete.
vi.mock('@openuidev/react-lang', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openuidev/react-lang')>()
  return {
    ...actual,
    Renderer: ({ response }: { response: string }) => {
      if (response.includes('BROKEN')) throw new Error('half-written program')
      return <div>{response.includes('done') ? 'Rendered block' : 'Partial block'}</div>
    },
  }
})

const fenced = (program: string) => `\`\`\`openui-lang\n${program}\n\`\`\`\n`

// Load the lazy renderer chunk once up front; under jsdom it takes seconds.
beforeAll(async () => {
  await import('../openui-block-content')
}, 60_000)

beforeEach(() => {
  useSettingsStore.setState({ settings: { [RENDER_OPENUI_BLOCKS_SETTING]: 'true' } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('OpenUI block render boundary', () => {
  it('recovers when a crashed block receives more source', async () => {
    const view = (program: string) => (
      <MarkdownStreamingContext.Provider value={true}>
        <MarkdownContent content={fenced(program)} />
      </MarkdownStreamingContext.Provider>
    )
    const { rerender } = render(view('root = Card([BROKEN'))
    expect(
      await screen.findByText('Could not render this data block', {}, { timeout: 5_000 })
    ).toBeInTheDocument()

    rerender(view('root = Card([header]) // done'))
    expect(await screen.findByText('Rendered block')).toBeInTheDocument()
    expect(screen.queryByText('Could not render this data block')).toBeNull()
  })
})
