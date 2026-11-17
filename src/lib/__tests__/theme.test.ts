import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setTheme = vi.fn(() => Promise.resolve())
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTheme }),
}))

// A controllable `prefers-color-scheme: dark` media query.
function mockSystemDark(initial: boolean) {
  let matches = initial
  const listeners = new Set<() => void>()
  window.matchMedia = vi.fn().mockImplementation(() => ({
    get matches() {
      return matches
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }))
  return (next: boolean) => {
    matches = next
    listeners.forEach((listener) => listener())
  }
}

async function loadTheme() {
  vi.resetModules()
  return import('@/lib/theme')
}

const isDarkClass = () => document.documentElement.classList.contains('dark')

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    setTheme.mockClear()
    Object.assign(window, { __TAURI_INTERNALS__: {} })
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('defaults to System and follows the OS appearance', async () => {
    const setSystemDark = mockSystemDark(true)
    const { initTheme, useThemeStore } = await loadTheme()
    initTheme()

    expect(useThemeStore.getState().preference).toBe('system')
    expect(useThemeStore.getState().resolved).toBe('dark')
    expect(isDarkClass()).toBe(true)
    expect(setTheme).toHaveBeenCalledWith(null)

    setSystemDark(false)
    expect(useThemeStore.getState().resolved).toBe('light')
    expect(isDarkClass()).toBe(false)
  })

  it('restores a saved preference on startup', async () => {
    mockSystemDark(false)
    localStorage.setItem('chatshell_theme', 'dark')
    const { initTheme, useThemeStore } = await loadTheme()
    initTheme()

    expect(useThemeStore.getState().preference).toBe('dark')
    expect(isDarkClass()).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(setTheme).toHaveBeenCalledWith('dark')
  })

  it('ignores an invalid saved preference', async () => {
    mockSystemDark(false)
    localStorage.setItem('chatshell_theme', 'sepia')
    const { useThemeStore } = await loadTheme()

    expect(useThemeStore.getState().preference).toBe('system')
  })

  it('persists and applies an explicit choice, ignoring OS changes', async () => {
    const setSystemDark = mockSystemDark(false)
    const { initTheme, useThemeStore } = await loadTheme()
    initTheme()

    useThemeStore.getState().setPreference('dark')
    expect(localStorage.getItem('chatshell_theme')).toBe('dark')
    expect(isDarkClass()).toBe(true)
    expect(setTheme).toHaveBeenLastCalledWith('dark')

    setSystemDark(false)
    expect(useThemeStore.getState().resolved).toBe('dark')

    useThemeStore.getState().setPreference('light')
    expect(isDarkClass()).toBe(false)
    expect(setTheme).toHaveBeenLastCalledWith('light')
  })
})
