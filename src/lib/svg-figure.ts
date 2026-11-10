/**
 * Inline SVG figures: theme palette, cached preparation through the Rust
 * core (`prepare_svg_figure`), and the reduced-motion preference.
 *
 * Figures render as isolated `<img>` documents, where page CSS variables do
 * not reach, so the core bakes theme colors into the SVG. The palette is read
 * from the live CSS variables and converted to hex with a 1px canvas (the
 * variables are `oklch(...)`, which the core does not parse).
 * Design: internal-docs/features/svg-figures.md.
 */
import { useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'

export const RENDER_SVG_FIGURES_SETTING = 'render_svg_figures'

export interface SvgPalette {
  fg: string
  muted: string
  border: string
  surface: string
  accent: string
  success: string
  warning: string
  error: string
  /** The six chart colors (`--chart-1`..`--chart-6`) for `--c1`..`--c6`, so
   * figures use the same palette, in the same order, as charts and diagrams. */
  series: string[]
  isDark: boolean
}

export interface PreparedSvg {
  svg: string
  width: number
  height: number
  animated: boolean
  removed: number
}

export type SvgFigureErrorKind = 'incomplete' | 'parse' | 'noRoot' | 'tooLarge' | 'empty'

export interface SvgFigureError {
  kind: SvgFigureErrorKind
  message: string
}

export interface PrepareOptions {
  streaming: boolean
  stripAnimation: boolean
}

/** Theme token → CSS variable it reads. */
const PALETTE_VARIABLES: Record<Exclude<keyof SvgPalette, 'isDark' | 'series'>, string> = {
  fg: '--foreground',
  muted: '--muted-foreground',
  border: '--border',
  surface: '--muted',
  accent: '--primary',
  success: '--success',
  warning: '--warning',
  error: '--destructive',
}

/** The visual palette, in order: cyan, pink, purple, amber, green, indigo. */
const SERIES_VARIABLES = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
] as const

const FALLBACK_PALETTE: SvgPalette = {
  fg: '#1a1a1a',
  muted: '#737373',
  border: '#e5e5e5',
  surface: '#f5f5f5',
  accent: '#1a1a1a',
  success: '#16a34a',
  warning: '#d97706',
  error: '#dc2626',
  // Empty: the core derives series colors from the accent.
  series: [],
  isDark: false,
}

let paletteCache: { key: string; palette: SvgPalette } | null = null
let probe: CanvasRenderingContext2D | null | undefined

/** Resolve any CSS color to `#rrggbb` by painting one pixel. */
export function cssColorToHex(color: string): string | null {
  const value = color.trim()
  if (!value) return null
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase()
  if (probe === undefined) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      probe = canvas.getContext('2d', { willReadFrequently: true })
    } catch {
      probe = null
    }
  }
  if (!probe) return null
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#000000'
  probe.fillStyle = value
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
  if (a === 0) return null
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

/**
 * The active theme's figure palette. Cached per theme class; the raw
 * variable values form the key, so a theme edit is picked up too.
 */
export function readSvgPalette(): SvgPalette {
  if (typeof document === 'undefined') return FALLBACK_PALETTE
  const style = getComputedStyle(document.documentElement)
  const raw = Object.values(PALETTE_VARIABLES).map((name) => style.getPropertyValue(name).trim())
  const rawSeries = SERIES_VARIABLES.map((name) => style.getPropertyValue(name).trim())
  const isDark = isDarkTheme()
  const key = `${isDark}|${raw.join('|')}|${rawSeries.join('|')}`
  if (paletteCache?.key === key) return paletteCache.palette
  const palette = { ...FALLBACK_PALETTE, isDark }
  ;(Object.keys(PALETTE_VARIABLES) as (keyof typeof PALETTE_VARIABLES)[]).forEach((token, at) => {
    const hex = cssColorToHex(raw[at])
    if (hex) palette[token] = hex
  })
  const series = rawSeries.map(cssColorToHex)
  palette.series = series.every((hex): hex is string => hex !== null) ? series : []
  paletteCache = { key, palette }
  return palette
}

/** Stable identity of a palette, for cache keys and effect dependencies. */
export function paletteKey(palette: SvgPalette): string {
  return [
    palette.fg,
    palette.muted,
    palette.border,
    palette.surface,
    palette.accent,
    palette.success,
    palette.warning,
    palette.error,
    palette.series.join(','),
    palette.isDark,
  ].join('|')
}

// ---------------------------------------------------------------------------
// Theme changes: re-read the palette when the root class list changes.
// ---------------------------------------------------------------------------

const themeListeners = new Set<() => void>()
let themeObserver: MutationObserver | null = null
let themeVersion = 0

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener)
  if (!themeObserver && typeof MutationObserver !== 'undefined') {
    themeObserver = new MutationObserver(() => {
      themeVersion += 1
      themeListeners.forEach((notify) => notify())
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    })
  }
  return () => {
    themeListeners.delete(listener)
    if (themeListeners.size === 0 && themeObserver) {
      themeObserver.disconnect()
      themeObserver = null
    }
  }
}

/** The figure palette, re-read when the document theme changes. */
export function useSvgPalette(): SvgPalette {
  useSyncExternalStore(
    subscribeTheme,
    () => themeVersion,
    () => 0
  )
  return readSvgPalette()
}

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(listener: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () =>
      typeof window !== 'undefined' && !!window.matchMedia
        ? window.matchMedia(REDUCED_MOTION_QUERY).matches
        : false,
    () => false
  )
}

// ---------------------------------------------------------------------------
// Preparation (cached)
// ---------------------------------------------------------------------------

type CacheEntry = { ok: true; value: PreparedSvg } | { ok: false; error: SvgFigureError }

const CACHE_LIMIT = 64
const cache = new Map<string, CacheEntry>()

function cacheKey(source: string, palette: SvgPalette, options: PrepareOptions): string {
  return `${options.streaming ? 1 : 0}${options.stripAnimation ? 1 : 0}|${paletteKey(palette)}|${source}`
}

function remember(key: string, entry: CacheEntry): void {
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** The cached outcome for these inputs, if any (synchronous, for first paint). */
export function peekPreparedSvg(
  source: string,
  palette: SvgPalette,
  options: PrepareOptions
): CacheEntry | undefined {
  const key = cacheKey(source, palette, options)
  const entry = cache.get(key)
  if (entry) remember(key, entry)
  return entry
}

function toFigureError(error: unknown): SvgFigureError {
  if (error && typeof error === 'object' && 'kind' in error && 'message' in error) {
    return error as SvgFigureError
  }
  return { kind: 'parse', message: String(error) }
}

/** Prepare a fence body; resolves to the cached outcome when one exists. */
export async function prepareSvgFigure(
  source: string,
  palette: SvgPalette,
  options: PrepareOptions
): Promise<CacheEntry> {
  const key = cacheKey(source, palette, options)
  const cached = cache.get(key)
  if (cached) {
    remember(key, cached)
    return cached
  }
  let entry: CacheEntry
  try {
    const value = await invoke<PreparedSvg>('prepare_svg_figure', {
      source,
      palette,
      options,
    })
    entry = { ok: true, value }
  } catch (error) {
    entry = { ok: false, error: toFigureError(error) }
  }
  remember(key, entry)
  return entry
}

/** `data:` URL for an `<img>`; percent-encoded UTF-8 keeps non-ASCII text intact. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Test hook: forget cached preparations and the palette. */
export function resetSvgFigureCaches(): void {
  cache.clear()
  paletteCache = null
}
