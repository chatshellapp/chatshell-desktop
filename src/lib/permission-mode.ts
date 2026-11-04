// Permission-mode defaults and sandbox availability, shared by the chat
// input, the conversation settings store, and Settings.
//
// There is no compiled-in permissive default: a conversation without a
// chosen mode starts in the device's `default_permission_mode` setting,
// and an unset or unknown setting means `ask` (the strictest mode).

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { PermissionMode } from '@/types'
import { logger } from '@/lib/logger'

export const DEFAULT_PERMISSION_MODE_KEY = 'default_permission_mode'

/** The mode used when nothing else is known. */
export const FAIL_SAFE_PERMISSION_MODE: PermissionMode = 'ask'

export function parsePermissionMode(value: string | null | undefined): PermissionMode | null {
  return value === 'ask' || value === 'auto' || value === 'yolo' ? value : null
}

/** The default mode from a loaded settings map. */
export function defaultPermissionMode(settings: Record<string, string>): PermissionMode {
  return parsePermissionMode(settings[DEFAULT_PERMISSION_MODE_KEY]) ?? FAIL_SAFE_PERMISSION_MODE
}

/** What the UI shows for `mode`: `auto` without a sandbox runs as `ask`. */
export function displayedPermissionMode(
  mode: PermissionMode,
  sandboxAvailable: boolean
): PermissionMode {
  return mode === 'auto' && !sandboxAvailable ? 'ask' : mode
}

let sandboxStatus: Promise<boolean> | null = null

/** Whether this machine has an OS sandbox (asked once per app run). */
export function loadSandboxAvailable(): Promise<boolean> {
  if (!sandboxStatus) {
    sandboxStatus = invoke<{ available: boolean }>('get_sandbox_status')
      .then((status) => status.available)
      .catch((error) => {
        logger.error('[permission-mode] get_sandbox_status failed:', error)
        return false
      })
  }
  return sandboxStatus
}

/** Test hook: forget the cached sandbox status. */
export function resetSandboxStatusForTests(): void {
  sandboxStatus = null
}

/** React hook: sandbox availability (false until known). */
export function useSandboxAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let active = true
    void loadSandboxAvailable().then((value) => {
      if (active) setAvailable(value)
    })
    return () => {
      active = false
    }
  }, [])
  return available
}
