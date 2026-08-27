import i18n from '@/lib/i18n'
import { logger } from '@/lib/logger'

/**
 * Error contract for the sync passphrase commands (`unlock_sync`,
 * `rotate_sync_key`), mirroring the Rust `SyncCommandError`. `code` maps to
 * the same user-facing copy the iOS app surfaces via `SyncErrorCopy` — raw
 * backend strings never reach the passphrase UI.
 */
export interface SyncCommandError {
  code: 'wrongPassphrase' | 'corruptData' | 'failed'
  message: string
}

const SYNC_ERROR_CODES: ReadonlyArray<SyncCommandError['code']> = [
  'wrongPassphrase',
  'corruptData',
  'failed',
]

export function isSyncCommandError(err: unknown): err is SyncCommandError {
  return (
    typeof err === 'object' &&
    err !== null &&
    SYNC_ERROR_CODES.includes((err as SyncCommandError).code)
  )
}

/**
 * Map a sync passphrase command rejection to user-facing copy. Expected
 * outcomes (wrong passphrase, damaged data) render localized guidance;
 * unexpected failures log the raw detail and render the generic retry copy.
 * Legacy untyped rejections pass through unchanged.
 */
export function syncErrorCopy(err: unknown): string {
  if (isSyncCommandError(err)) {
    switch (err.code) {
      case 'wrongPassphrase':
        return i18n.t('errors.wrongPassphrase', { ns: 'sync' })
      case 'corruptData':
        return i18n.t('errors.corruptData', { ns: 'sync' })
      case 'failed':
        logger.error('Sync command failed:', err.message)
        return i18n.t('errors.failed', { ns: 'sync' })
    }
  }
  return err instanceof Error ? err.message : String(err)
}
