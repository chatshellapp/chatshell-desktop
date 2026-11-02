import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import i18n from '@/lib/i18n'
import { ReleaseNotes } from '@/components/settings-dialog/release-notes'

const mockedOpenUrl = vi.mocked(openUrl)

const NOTES = `### Added

- In-app updates.
- See the [docs](https://chatshell.app/docs/) and [a local file](file:///etc/passwd).

### Fixed

- Links open again. <img src=x onerror="alert(1)"><script>alert(2)</script>`

describe('ReleaseNotes', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    mockedOpenUrl.mockReset()
  })

  it('renders the changelog section as markdown', () => {
    render(<ReleaseNotes version="0.9.2" notes={NOTES} />)

    expect(screen.getByText('Added')).toBeInTheDocument()
    expect(screen.getByText('Fixed')).toBeInTheDocument()
    expect(screen.getByText('In-app updates.')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('drops raw HTML from the feed', () => {
    render(<ReleaseNotes version="0.9.2" notes={NOTES} />)

    const notes = screen.getByTestId('release-notes')
    expect(notes.querySelector('img')).toBeNull()
    expect(notes.querySelector('script')).toBeNull()
    expect(notes.innerHTML).not.toContain('onerror')
  })

  it('follows only http(s) links', async () => {
    render(<ReleaseNotes version="0.9.2" notes={NOTES} />)

    expect(screen.queryByRole('button', { name: 'a local file' })).toBeNull()
    expect(screen.getByText(/a local file/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'docs' }))
    await waitFor(() => expect(mockedOpenUrl).toHaveBeenCalledWith('https://chatshell.app/docs/'))
  })

  it('links to the version on the website changelog', async () => {
    render(<ReleaseNotes version="0.9.2" />)

    expect(screen.queryByTestId('release-notes')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Full changelog' }))
    await waitFor(() =>
      expect(mockedOpenUrl).toHaveBeenCalledWith('https://chatshell.app/changelog/#v0.9.2')
    )
  })
})
