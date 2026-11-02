import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import i18n from '@/lib/i18n'
import { resetSvgFigureCaches, svgDataUrl, cssColorToHex } from '@/lib/svg-figure'
import { useSettingsStore } from '@/stores/settingsStore'
import { SvgFigureBlock } from '../svg-figure-block'
import { MarkdownStreamingContext } from '../streaming-context'
import { MarkdownContent } from '../index'

void i18n

const invokeMock = vi.mocked(invoke)

const GOOD = '<svg viewBox="0 0 200 100"><title>Flow</title><rect width="10" height="10"/></svg>'
const PREPARED = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="10" height="10"/></svg>',
  width: 200,
  height: 100,
  animated: false,
  removed: 0,
}

type PrepareArgs = {
  source: string
  options: { streaming: boolean; stripAnimation: boolean }
}

function prepareCalls(): PrepareArgs[] {
  return invokeMock.mock.calls
    .filter(([command]) => command === 'prepare_svg_figure')
    .map(([, args]) => args as PrepareArgs)
}

beforeEach(() => {
  resetSvgFigureCaches()
  invokeMock.mockReset()
  useSettingsStore.setState({ settings: {} })
})

describe('SvgFigureBlock', () => {
  it('renders a final figure as an isolated image', async () => {
    invokeMock.mockResolvedValue(PREPARED)
    render(<SvgFigureBlock code={GOOD} />)

    const image = await screen.findByRole('img', { name: 'Flow' })
    expect(image).toHaveAttribute('src', svgDataUrl(PREPARED.svg))
    expect(image).toHaveAttribute('width', '200')
    expect(prepareCalls()[0].options).toEqual({ streaming: false, stripAnimation: false })
    // Never injected into the page DOM.
    expect(document.querySelector('svg[viewBox="0 0 200 100"]')).toBeNull()
  })

  it('falls back to the code block when the final source does not render', async () => {
    invokeMock.mockRejectedValue({ kind: 'parse', message: 'Invalid SVG: missing viewBox' })
    render(<SvgFigureBlock code="<svg><rect/></svg>" />)

    expect(await screen.findByText('Could not render this figure')).toBeInTheDocument()
    expect(screen.getByTestId('svg-figure-fallback')).toHaveTextContent('<svg><rect/></svg>')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('keeps the last good figure while a streaming revision fails', async () => {
    invokeMock.mockResolvedValueOnce(PREPARED)
    const { rerender } = render(
      <MarkdownStreamingContext.Provider value={true}>
        <SvgFigureBlock code={GOOD} />
      </MarkdownStreamingContext.Provider>
    )
    await screen.findByRole('img', { name: 'Flow' })
    expect(prepareCalls()[0].options.streaming).toBe(true)

    invokeMock.mockRejectedValueOnce({ kind: 'parse', message: 'broken' })
    rerender(
      <MarkdownStreamingContext.Provider value={true}>
        <SvgFigureBlock code={`${GOOD}<g`} />
      </MarkdownStreamingContext.Provider>
    )
    await waitFor(() => expect(prepareCalls()).toHaveLength(2))
    expect(screen.getByRole('img', { name: 'Flow' })).toBeInTheDocument()
    expect(screen.queryByText('Could not render this figure')).toBeNull()
  })

  it('shows a placeholder until the first streaming revision draws', async () => {
    invokeMock.mockRejectedValue({ kind: 'incomplete', message: 'SVG root tag is incomplete' })
    render(
      <MarkdownStreamingContext.Provider value={true}>
        <SvgFigureBlock code="<svg viewBox=" />
      </MarkdownStreamingContext.Provider>
    )
    expect(screen.getByText('Drawing figure...')).toBeInTheDocument()
    await waitFor(() => expect(prepareCalls()).toHaveLength(1))
    expect(screen.getByText('Drawing figure...')).toBeInTheDocument()
  })

  it('offers pause for animated figures and re-prepares without animation', async () => {
    invokeMock.mockResolvedValue({ ...PREPARED, animated: true })
    render(<SvgFigureBlock code={GOOD} />)
    const pause = await screen.findByRole('button', { name: 'Pause animation' })

    await act(async () => pause.click())
    await waitFor(() =>
      expect(prepareCalls().some((call) => call.options.stripAnimation)).toBe(true)
    )
    expect(await screen.findByRole('button', { name: 'Play animation' })).toBeInTheDocument()
  })
})

describe('MarkdownContent svg fences', () => {
  const markdown = `Here:\n\n\`\`\`svg\n${GOOD}\n\`\`\`\n`

  it('renders svg fences as figures by default', async () => {
    invokeMock.mockResolvedValue(PREPARED)
    render(<MarkdownContent content={markdown} />)
    expect(await screen.findByRole('img', { name: 'Flow' })).toBeInTheDocument()
  })

  it('keeps svg fences as code when the setting is off', () => {
    useSettingsStore.setState({ settings: { render_svg_figures: 'false' } })
    render(<MarkdownContent content={markdown} />)
    expect(screen.queryByTestId('svg-figure')).toBeNull()
    expect(prepareCalls()).toHaveLength(0)
  })
})

describe('svg-figure helpers', () => {
  it('passes hex colors through and encodes data URLs', () => {
    expect(cssColorToHex('#AABBCC')).toBe('#aabbcc')
    expect(svgDataUrl('<svg>é#</svg>')).toBe(
      'data:image/svg+xml;charset=utf-8,%3Csvg%3E%C3%A9%23%3C%2Fsvg%3E'
    )
  })
})
