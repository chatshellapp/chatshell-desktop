import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import i18n from '@/lib/i18n'
import { RENDER_OPENUI_BLOCKS_SETTING } from '@/lib/openui/settings'
import { useSettingsStore } from '@/stores/settingsStore'
import { MarkdownContent } from '../index'
import { MarkdownStreamingContext } from '../streaming-context'

void i18n

const STATS = [
  'root = Stats([revenue, churn])',
  'revenue = Stat("Revenue", "$48.2k", "+8.1%", "vs last month")',
  'churn = Stat("Churn", "1.8%", "-0.3 pt")',
].join('\n')

const TILE_CHART = [
  'root = Chart("bar", "Visitors", days, [desktop, mobile], "Last 3 days")',
  'days = ["Apr 1", "Apr 2", "Apr 3"]',
  'desktop = Series("Desktop", [222, 97, 167], "486")',
  'mobile = Series("Mobile", [150, 180, 120], "450")',
].join('\n')

// Written for upstream OpenUI's chat library: a form, a button, and a
// follow-up. None of these components is in ChatShell's library.
const FOREIGN_PROGRAM = [
  'root = Card([header, form, followUps])',
  'header = CardHeader("Plan the trip")',
  'form = Form("trip", buttons, [noteField])',
  'noteField = FormControl("Note", Input("note", "Anything else?"))',
  'buttons = Buttons([Button("Plan it", @ToAssistant("Plan the trip"), "primary")])',
  'followUps = FollowUpBlock([FollowUpItem("Show hotels")])',
].join('\n')

const fenced = (program: string, language = 'openui-lang') =>
  `Here you go:\n\n\`\`\`${language}\n${program}\n\`\`\`\n`

beforeAll(async () => {
  // Recharts measures its container; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  // Load the lazy renderer chunk once up front.
  await import('../openui-block-content')
}, 60_000)

beforeEach(() => {
  useSettingsStore.setState({ settings: { [RENDER_OPENUI_BLOCKS_SETTING]: 'true' } })
  vi.mocked(invoke).mockReset()
})

describe('OpenUI blocks in Markdown', () => {
  it('renders KPI cards without calling the backend', async () => {
    render(<MarkdownContent content={fenced(STATS)} />)
    expect(await screen.findByText('$48.2k', {}, { timeout: 5_000 })).toBeInTheDocument()
    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('+8.1%')).toBeInTheDocument()
    expect(screen.getByText('vs last month')).toBeInTheDocument()
    expect(screen.getByText('1.8%')).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('shows series totals as tiles that switch the plotted series', async () => {
    render(<MarkdownContent content={fenced(TILE_CHART)} />)
    expect(await screen.findByText('Visitors', {}, { timeout: 5_000 })).toBeInTheDocument()
    expect(screen.getByText('Last 3 days')).toBeInTheDocument()
    const desktop = screen.getByRole('button', { name: /Desktop\s*486/ })
    const mobile = screen.getByRole('button', { name: /Mobile\s*450/ })
    expect(desktop).toHaveAttribute('aria-pressed', 'true')
    expect(mobile).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(mobile)
    expect(mobile).toHaveAttribute('aria-pressed', 'true')
    expect(desktop).toHaveAttribute('aria-pressed', 'false')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('accepts a lone series and a lone stat without list brackets', async () => {
    // Written by a model: `price` where `[price]` was expected.
    const chart = [
      'root = Chart("line", "TSLA monthly closing price, Oct 2025 – Nov 2026", labels, price, "US dollars per share")',
      'labels = ["Oct \'25", "Nov", "Dec"]',
      'price = Series("Close", [456.56, 430.17, 449.72])',
    ].join('\n')
    const { unmount } = render(<MarkdownContent content={fenced(chart)} />)
    expect(
      await screen.findByText('US dollars per share', {}, { timeout: 5_000 })
    ).toBeInTheDocument()
    expect(screen.queryByText('Could not render this data block')).toBeNull()
    unmount()

    render(
      <MarkdownContent
        content={fenced('root = Stats(revenue)\nrevenue = Stat("Revenue", "$48.2k")')}
      />
    )
    expect(await screen.findByText('$48.2k', {}, { timeout: 5_000 })).toBeInTheDocument()
  })

  it('shows the source of a program written for another library', async () => {
    render(<MarkdownContent content={fenced(FOREIGN_PROGRAM)} />)
    expect(
      await screen.findByText('Could not render this data block', {}, { timeout: 5_000 })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Plan it' })).toBeNull()
    expect(screen.queryByPlaceholderText('Anything else?')).toBeNull()
  })

  it('matches the fence language case-insensitively', async () => {
    render(<MarkdownContent content={fenced(STATS, 'OpenUI-Lang')} />)
    expect(await screen.findByText('$48.2k', {}, { timeout: 5_000 })).toBeInTheDocument()
  })

  it('renders blocks by default, before the setting is ever saved', async () => {
    useSettingsStore.setState({ settings: {} })
    render(<MarkdownContent content={fenced(STATS)} />)
    expect(await screen.findByText('$48.2k', {}, { timeout: 5_000 })).toBeInTheDocument()
  })

  it('shows the fence as code while the setting is off', () => {
    useSettingsStore.setState({ settings: { [RENDER_OPENUI_BLOCKS_SETTING]: 'false' } })
    render(<MarkdownContent content={fenced(STATS)} />)
    expect(screen.queryByText('Revenue')).toBeNull()
    expect(screen.getByText(/openui-lang/i)).toBeInTheDocument()
  })

  it('falls back to the source when a finished block has nothing to render', async () => {
    render(<MarkdownContent content={fenced('this is not a program')} />)
    expect(
      await screen.findByText('Could not render this data block', {}, { timeout: 5_000 })
    ).toBeInTheDocument()
  })

  it('keeps rendering a partial block while the message streams', async () => {
    render(
      <MarkdownStreamingContext.Provider value={true}>
        <MarkdownContent
          content={fenced('root = Stats([revenue])\nrevenue = Stat("Revenue", "$48')}
        />
      </MarkdownStreamingContext.Provider>
    )
    expect(await screen.findByText(/\$48/, {}, { timeout: 5_000 })).toBeInTheDocument()
    expect(screen.queryByText('Could not render this data block')).toBeNull()
  })
})
