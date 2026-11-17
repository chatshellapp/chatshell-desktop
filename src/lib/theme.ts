// App theme: Light, Dark, or System (follow the OS appearance).
//
// The preference is a per-device choice stored in localStorage (like the UI
// language), which lets public/theme-init.js apply it synchronously before the
// first paint. This module owns it after startup: it toggles the Tailwind
// `.dark` class on <html>, tracks OS appearance changes while on System, and
// keeps the native window chrome (title bar, menus) in step.

import { getCurrentWindow } from '@tauri-apps/api/window'
import { create } from 'zustand'

import { logger } from '@/lib/logger'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

// Keep in step with public/theme-init.js.
const THEME_KEY = 'chatshell_theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (isThemePreference(saved)) return saved
  } catch {
    // Storage unavailable: fall through to the default.
  }
  return 'system'
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(DARK_QUERY).matches
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return preference
}

function applyToDocument(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

// The native window follows the OS on System (null); otherwise it is pinned
// so the title bar matches the web content.
function applyToWindow(preference: ThemePreference) {
  if (!('__TAURI_INTERNALS__' in window)) return
  getCurrentWindow()
    .setTheme(preference === 'system' ? null : preference)
    .catch((error) => logger.warn('Failed to set native window theme:', error))
}

interface ThemeState {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

const initialPreference = readPreference()

export const useThemeStore = create<ThemeState>((set) => ({
  preference: initialPreference,
  resolved: resolve(initialPreference),
  setPreference: (preference) => {
    try {
      localStorage.setItem(THEME_KEY, preference)
    } catch (error) {
      logger.warn('Failed to persist theme preference:', error)
    }
    const resolved = resolve(preference)
    applyToDocument(resolved)
    applyToWindow(preference)
    set({ preference, resolved })
  },
}))

/** The theme currently on screen, after resolving System. */
export function useResolvedTheme(): ResolvedTheme {
  return useThemeStore((state) => state.resolved)
}

/**
 * Applies the stored preference and starts following OS appearance changes.
 * Called once at startup.
 */
export function initTheme() {
  const { preference, resolved } = useThemeStore.getState()
  applyToDocument(resolved)
  applyToWindow(preference)

  window.matchMedia?.(DARK_QUERY).addEventListener('change', () => {
    const state = useThemeStore.getState()
    if (state.preference !== 'system') return
    const next = resolve('system')
    if (next === state.resolved) return
    applyToDocument(next)
    useThemeStore.setState({ resolved: next })
  })
}
