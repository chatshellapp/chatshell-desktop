import { describe, it, expect, beforeAll } from 'vitest'
import i18n from '@/lib/i18n'
import { syncErrorCopy } from '@/lib/sync-error'

/** The rejection shape the Rust `SyncCommandError` serializes to. */
function typedError(code: string, message = 'detail') {
  return { code, message }
}

describe('syncErrorCopy', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('maps typed codes to the iOS-parity guidance copy', () => {
    expect(syncErrorCopy(typedError('wrongPassphrase'))).toBe(
      "That passphrase doesn't match. Check the phrase you saved when sync was first enabled."
    )
    expect(syncErrorCopy(typedError('corruptData'))).toBe(
      'The synced data in iCloud Drive appears damaged or was written by a newer version of ChatShell. Update the app on every device and try again.'
    )
    expect(syncErrorCopy(typedError('failed'))).toBe(
      "That didn't work. Check your connection to iCloud Drive and try again."
    )
  })
  it('passes legacy string rejections through unchanged', () => {
    // Pre-typed-error backend strings and unexpected shapes must not be
    // swallowed — the raw message stays visible for diagnostics.
    expect(syncErrorCopy(new Error('No sync target available'))).toBe('No sync target available')
    expect(syncErrorCopy('unlock failed')).toBe('unlock failed')
  })

  it('renders the localized copy when the language changes', async () => {
    await i18n.changeLanguage('zh-CN')
    try {
      expect(syncErrorCopy(typedError('wrongPassphrase'))).toBe(
        '口令不匹配。请核对首次开启同步时保存的口令。'
      )
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
