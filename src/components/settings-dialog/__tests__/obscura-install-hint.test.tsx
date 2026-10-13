import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import i18n from '@/lib/i18n'
import { ObscuraInstallHint } from '@/components/settings-dialog/obscura-install-hint'

const mockedOpenUrl = vi.mocked(openUrl)

describe('ObscuraInstallHint', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    mockedOpenUrl.mockReset()
  })

  it('renders install guidance with resolution instructions', () => {
    render(<ObscuraInstallHint />)

    expect(screen.getByText('Obscura not detected')).toBeInTheDocument()
    expect(screen.getByText(/Put the binary on your PATH or next to the app/)).toBeInTheDocument()
    expect(
      screen.getByText(/upgrades the automatic fallback chain for web fetching/)
    ).toBeInTheDocument()
  })

  it('opens the Obscura repository when Learn more is clicked', async () => {
    render(<ObscuraInstallHint />)

    fireEvent.click(screen.getByRole('button', { name: 'Learn more about Obscura' }))

    await waitFor(() =>
      expect(mockedOpenUrl).toHaveBeenCalledWith('https://github.com/h4ckf0r0day/obscura')
    )
  })
})
