import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  FetchResultPreview,
  SearchResultFetchItem,
  ProcessingUrlItem,
} from '../fetch-result-preview'
import { logger } from '@/lib/logger'
import '@/lib/i18n'
import type { FetchResult } from '@/types'

vi.mock('@/components/markdown-content', () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="markdown-content">{content}</div>
  ),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const mockInvoke = vi.mocked(invoke)
const mockOpenUrl = vi.mocked(openUrl)

function makeFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    id: 'fr-1',
    source_type: 'url',
    url: 'https://example.com/article',
    storage_path: '/tmp/fetch/abc.md',
    content_type: 'text/markdown',
    status: 'success',
    favicon_url: 'https://example.com/favicon.ico',
    content_hash: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function rowButtonOf(text: string | RegExp): HTMLElement {
  const row = screen.getByText(text).closest('button')
  if (!(row instanceof HTMLElement)) throw new Error(`no row button found for ${String(text)}`)
  return row
}

describe('FetchResultPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the fetched chip with title, domain and favicon', () => {
    const { container } = render(
      <FetchResultPreview fetchResult={makeFetchResult({ title: 'My Article' })} />
    )

    expect(screen.getByText('Fetched')).toBeInTheDocument()
    expect(screen.getByText('My Article')).toBeInTheDocument()
    expect(screen.getByText('example.com')).toBeInTheDocument()
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/favicon.ico'
    )
  })

  it('falls back to the domain as title when the result has none', () => {
    render(<FetchResultPreview fetchResult={makeFetchResult({ title: undefined })} />)

    const domainTexts = screen.getAllByText('example.com')
    expect(domainTexts.length).toBeGreaterThanOrEqual(2)
  })

  it('falls back to a globe icon when no favicon can be derived', () => {
    const { container } = render(
      <FetchResultPreview
        fetchResult={makeFetchResult({ url: 'not-a-valid-url', favicon_url: undefined })}
      />
    )

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('swaps the favicon for a globe icon when the favicon fails to load', () => {
    const { container } = render(
      <FetchResultPreview fetchResult={makeFetchResult({ title: 'My Article' })} />
    )

    fireEvent.error(container.querySelector('img') as HTMLImageElement)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('loads the stored content into the dialog when the row is opened', async () => {
    let resolveContent: ((value: string) => void) | undefined
    mockInvoke.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveContent = resolve
        })
    )
    render(<FetchResultPreview fetchResult={makeFetchResult({ title: 'My Article' })} />)

    fireEvent.click(rowButtonOf('My Article'))

    expect(await screen.findByText('Loading content...')).toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledWith('read_fetch_content', {
      storagePath: '/tmp/fetch/abc.md',
    })

    act(() => {
      resolveContent?.('# Loaded content')
    })
    expect(await screen.findByText('# Loaded content')).toBeInTheDocument()
  })

  it('latches a failed load instead of retrying in a loop, and retries after reopening', async () => {
    mockInvoke
      .mockImplementationOnce(() => Promise.reject(new Error('disk error')))
      .mockResolvedValue('# Recovered')
    render(<FetchResultPreview fetchResult={makeFetchResult({ title: 'My Article' })} />)

    fireEvent.click(rowButtonOf('My Article'))
    const dialog = await screen.findByRole('dialog')

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith('Failed to load fetch content:', expect.any(Error))
    )
    // The rejected load stays latched: no markdown, stable placeholder, no retry storm
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByText('No content available')).toBeInTheDocument()
    expect(screen.queryByTestId('markdown-content')).toBeNull()
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockInvoke).toHaveBeenCalledTimes(1)

    // Closing clears the latch so reopening retries and succeeds
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(rowButtonOf('My Article'))

    expect(await screen.findByText('# Recovered')).toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })

  it('opens the link and closes the dialog from the footer', async () => {
    mockInvoke.mockResolvedValue('# Stored')
    render(<FetchResultPreview fetchResult={makeFetchResult({ title: 'My Article' })} />)

    fireEvent.click(rowButtonOf('My Article'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('https://example.com/article')

    fireEvent.click(within(dialog).getByRole('button', { name: /Open Link/ }))

    expect(mockOpenUrl).toHaveBeenCalledWith('https://example.com/article')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes the dialog without opening the link when cancelled', async () => {
    mockInvoke.mockResolvedValue('# Stored')
    render(<FetchResultPreview fetchResult={makeFetchResult({ title: 'My Article' })} />)

    fireEvent.click(rowButtonOf('My Article'))
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(mockOpenUrl).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('renders the failed state with the error details in the dialog', async () => {
    render(
      <FetchResultPreview
        fetchResult={makeFetchResult({
          status: 'failed',
          error: 'HTTP 404',
          title: 'My Article',
        })}
      />
    )

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.queryByText('Fetched')).toBeNull()

    fireEvent.click(rowButtonOf('example.com'))
    const dialog = await screen.findByRole('dialog')

    expect(dialog).toHaveTextContent('Failed to fetch')
    expect(dialog).toHaveTextContent('https://example.com/article')
    expect(dialog).toHaveTextContent('HTTP 404')
    expect(within(dialog).queryByText('No content available')).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('SearchResultFetchItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an inline fetched row that loads content on demand', async () => {
    mockInvoke.mockResolvedValue('# Inline content')
    render(<SearchResultFetchItem fetchResult={makeFetchResult({ title: 'Inline Hit' })} />)

    expect(screen.getByText('Fetched')).toBeInTheDocument()
    expect(screen.getByText('Inline Hit')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(rowButtonOf('Inline Hit'))

    expect(await screen.findByText('# Inline content')).toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledWith('read_fetch_content', {
      storagePath: '/tmp/fetch/abc.md',
    })
  })

  it('does not propagate row clicks to surrounding result items', () => {
    const onSurroundingClick = vi.fn()
    render(
      <div onClick={onSurroundingClick}>
        <SearchResultFetchItem fetchResult={makeFetchResult({ title: 'Inline Hit' })} />
      </div>
    )

    fireEvent.click(rowButtonOf('Inline Hit'))

    expect(onSurroundingClick).not.toHaveBeenCalled()
  })

  it('renders the inline failed state and exposes the error in the dialog', async () => {
    render(
      <SearchResultFetchItem
        fetchResult={makeFetchResult({
          status: 'failed',
          error: 'timeout',
          title: 'Inline Miss',
        })}
      />
    )

    const row = rowButtonOf('Inline Miss')
    expect(within(row).getByText('Failed')).toBeInTheDocument()
    expect(row.querySelector('svg')).toBeInTheDocument()

    fireEvent.click(row)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Failed to fetch')
    expect(dialog).toHaveTextContent('timeout')
    expect(within(dialog).queryByText('Loading content...')).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('ProcessingUrlItem', () => {
  it('shows a fetching indicator with the domain while the URL is processed', () => {
    const { container } = render(<ProcessingUrlItem url="https://example.com/article" />)

    expect(screen.getByText('Fetching example.com')).toBeInTheDocument()
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('animate-pulse')
  })
})
