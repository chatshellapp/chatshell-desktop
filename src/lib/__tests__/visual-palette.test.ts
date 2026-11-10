import { afterEach, describe, expect, it } from 'vitest'

import { mermaidThemeVariables, mix } from '../mermaid-theme'
import { paletteKey, readSvgPalette, type SvgPalette } from '../svg-figure'

// The visual palette in its fixed order: cyan, pink, purple, amber, green, indigo.
const LIGHT = ['#0097a7', '#d81b60', '#8e24aa', '#ef6c00', '#388e3c', '#3f51b5']
const DARK = ['#00e5ff', '#ff4081', '#e040fb', '#ffca28', '#66bb6a', '#8c9eff']

const palette = (series: string[], isDark = false): SvgPalette => ({
  fg: isDark ? '#fafafa' : '#1a1a1a',
  muted: '#737373',
  border: '#e5e5e5',
  surface: '#f5f5f5',
  accent: '#1a1a1a',
  success: '#16a34a',
  warning: '#d97706',
  error: '#dc2626',
  series,
  isDark,
})

afterEach(() => {
  for (let at = 1; at <= 6; at++) document.documentElement.style.removeProperty(`--chart-${at}`)
})

describe('readSvgPalette', () => {
  it('reads the six chart colors as the figure series, in order', () => {
    LIGHT.forEach((color, at) =>
      document.documentElement.style.setProperty(`--chart-${at + 1}`, color)
    )
    const read = readSvgPalette()
    expect(read.series).toEqual(LIGHT)
    expect(paletteKey(read)).toContain(LIGHT.join(','))
  })

  it('leaves the series empty when a chart color is missing', () => {
    LIGHT.slice(0, 5).forEach((color, at) =>
      document.documentElement.style.setProperty(`--chart-${at + 1}`, color)
    )
    expect(readSvgPalette().series).toEqual([])
  })
})

describe('mermaidThemeVariables', () => {
  it('leads with cyan and keeps the palette order', () => {
    const variables = mermaidThemeVariables(palette(LIGHT), '#ffffff')
    expect(variables.primaryBorderColor).toBe('#0097a7')
    expect(variables.secondaryBorderColor).toBe('#d81b60')
    expect(variables.tertiaryBorderColor).toBe('#8e24aa')
    expect([1, 2, 3, 4, 5, 6, 7].map((at) => variables[`pie${at}`])).toEqual([...LIGHT, LIGHT[0]])
    expect((variables.xyChart as { plotColorPalette: string }).plotColorPalette).toBe(
      LIGHT.join(',')
    )
  })

  it('tints box fills toward the background so labels stay readable', () => {
    const variables = mermaidThemeVariables(palette(LIGHT), '#ffffff')
    expect(variables.primaryColor).toBe(mix('#0097a7', '#ffffff', 0.14))
    expect(variables.primaryTextColor).toBe('#1a1a1a')
  })

  it('uses the bright accents and dark mode on a dark background', () => {
    const variables = mermaidThemeVariables(palette(DARK, true), '#1c1c1c')
    expect(variables.darkMode).toBe(true)
    expect(variables.primaryBorderColor).toBe('#00e5ff')
    expect(variables.pie3).toBe('#e040fb')
    expect(variables.background).toBe('#1c1c1c')
  })

  it('falls back to the palette when the series could not be read', () => {
    expect(mermaidThemeVariables(palette([], true), '#1c1c1c').pie1).toBe('#00e5ff')
    expect(mermaidThemeVariables(palette([]), '#ffffff').pie1).toBe('#0097a7')
  })
})

describe('mix', () => {
  it('blends between background and color', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 1)).toBe('#000000')
    expect(mix('#ff0000', '#000000', 0.5)).toBe('#800000')
  })
})
