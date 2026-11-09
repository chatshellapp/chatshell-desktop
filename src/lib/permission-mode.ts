// Permission-mode defaults, sandbox availability, and auto-review
// eligibility, shared by the chat input, the conversation settings store,
// and Settings.
//
// There is no compiled-in permissive default: a conversation without a
// chosen mode starts in the device's `default_permission_mode` setting,
// and an unset or unknown setting means `ask` (the strictest mode).
//
// `auto` resolves per model, identically on every platform: judged by the
// auto reviewer when the model is eligible, else `ask`. `ask` runs bash in
// the OS sandbox wherever one exists (escapes, file edits, and tool use
// are confirmed); without one, every command is confirmed.

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

/** How `auto` resolves for a model (backend `get_auto_review_status`). */
export interface AutoReviewStatus {
  resolution: 'judged' | 'ask'
  /** Why the auto reviewer is not used, when it is not. */
  reason: string | null
  /** The judging model (`provider/model`). */
  judge: string | null
}

/** What the UI shows for `mode`: `auto` that resolves to `ask` (no
 * eligible reviewer) shows as `ask`. Unknown status shows the requested
 * mode. */
export function displayedPermissionMode(
  mode: PermissionMode,
  status: AutoReviewStatus | null
): PermissionMode {
  return mode === 'auto' && status?.resolution === 'ask' ? 'ask' : mode
}

/** The i18n key (namespace `chat`) of a mode's one-line hint. `ask` is
 * platform-conditional: sandboxed bash runs silently and only escapes,
 * file edits, and tool use are confirmed; without a sandbox every command
 * is confirmed. `auto` in the default-mode setting uses its own key. */
export function permissionModeHintKey(mode: PermissionMode, sandboxAvailable: boolean): string {
  if (mode === 'ask' && sandboxAvailable) return 'permission.mode.askSandboxHint'
  return `permission.mode.${mode}Hint`
}

/** Ask the backend how `auto` resolves for a model. `recheck` drops the
 * cached capability result first (a model change). */
export function loadAutoReviewStatus(
  modelDbId: string,
  recheck: boolean
): Promise<AutoReviewStatus | null> {
  return invoke<AutoReviewStatus>('get_auto_review_status', { modelDbId, recheck }).catch(
    (error) => {
      logger.error('[permission-mode] get_auto_review_status failed:', error)
      return null
    }
  )
}

/** React hook: auto-review status of the selected model (`null` until
 * known). A change of model re-checks its capability; the first look at
 * a model uses the backend's cache. */
export function useAutoReviewStatus(modelDbId: string | null | undefined): AutoReviewStatus | null {
  const [status, setStatus] = useState<AutoReviewStatus | null>(null)
  const [previous, setPrevious] = useState<string | null | undefined>(modelDbId)
  if (previous !== modelDbId) {
    setPrevious(modelDbId)
    setStatus(null)
  }
  useEffect(() => {
    if (!modelDbId) return
    let active = true
    const recheck = changedModels.has(modelDbId)
    changedModels.add(modelDbId)
    void loadAutoReviewStatus(modelDbId, recheck).then((value) => {
      if (active) setStatus(value)
    })
    return () => {
      active = false
    }
  }, [modelDbId])
  return status
}

/** Models already looked at this run: a later selection is a model change
 * and re-probes. */
const changedModels = new Set<string>()

/** OS sandbox backend of this machine, as reported by the backend. */
export interface SandboxStatus {
  available: boolean
  backend: 'seatbelt' | 'bubblewrap' | null
}

const UNAVAILABLE: SandboxStatus = { available: false, backend: null }

let sandboxStatus: Promise<SandboxStatus> | null = null

/** This machine's sandbox status (asked once per app run). */
export function loadSandboxStatus(): Promise<SandboxStatus> {
  if (!sandboxStatus) {
    sandboxStatus = invoke<SandboxStatus>('get_sandbox_status').catch((error) => {
      logger.error('[permission-mode] get_sandbox_status failed:', error)
      return UNAVAILABLE
    })
  }
  return sandboxStatus
}

/** Whether this machine has an OS sandbox. */
export function loadSandboxAvailable(): Promise<boolean> {
  return loadSandboxStatus().then((status) => status.available)
}

/** Test hook: forget the cached sandbox status. */
export function resetSandboxStatusForTests(): void {
  sandboxStatus = null
}

/** React hook: full sandbox status (`null` until known). */
export function useSandboxStatus(): SandboxStatus | null {
  const [status, setStatus] = useState<SandboxStatus | null>(null)
  useEffect(() => {
    let active = true
    void loadSandboxStatus().then((value) => {
      if (active) setStatus(value)
    })
    return () => {
      active = false
    }
  }, [])
  return status
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
