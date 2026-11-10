/**
 * Mermaid theme from the app's visual palette (`--chart-1`..`--chart-6`:
 * cyan, pink, purple, amber, green, indigo), so diagrams use the same colors,
 * in the same order, as OpenUI charts and SVG figures, in light and dark mode.
 *
 * Mermaid's `base` theme derives shades from the variables with khroma, which
 * needs hex colors; the palette comes from `readSvgPalette`, already in hex.
 * Boxes get a light tint of a palette color with a full-strength border, so
 * labels in the foreground color stay readable.
 * Design: internal-docs/features/visual-palette.md.
 */
import { cssColorToHex, type SvgPalette } from './svg-figure'

/** The visual palette's hex values, used when the CSS variables are missing. */
const FALLBACK_SERIES = {
  light: ['#0097a7', '#d81b60', '#8e24aa', '#ef6c00', '#388e3c', '#3f51b5'],
  dark: ['#00e5ff', '#ff4081', '#e040fb', '#ffca28', '#66bb6a', '#8c9eff'],
}

/** How much palette color goes into a box fill, over the background. */
const TINT = { light: 0.14, dark: 0.24 }

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1, 7), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** `color` mixed over `background`, `amount` of the way (both `#rrggbb`). */
export function mix(color: string, background: string, amount: number): string {
  const top = channels(color)
  const bottom = channels(background)
  return `#${top
    .map((channel, at) => Math.round(bottom[at] + (channel - bottom[at]) * amount))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

/** The card background Mermaid draws on, in hex. */
export function readDiagramBackground(isDark: boolean): string {
  if (typeof document !== 'undefined') {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--card')
    const hex = cssColorToHex(value)
    if (hex) return hex
  }
  return isDark ? '#1c1c1c' : '#ffffff'
}

/** Mermaid `themeVariables` for the `base` theme. */
export function mermaidThemeVariables(
  palette: SvgPalette,
  background: string
): Record<string, unknown> {
  const mode = palette.isDark ? 'dark' : 'light'
  const series = palette.series.length === 6 ? palette.series : FALLBACK_SERIES[mode]
  const tint = (at: number) => mix(series[at % series.length], background, TINT[mode])
  const fg = palette.fg
  // Pie slices and chart marks are full-strength, so their labels need the
  // background color: dark shades on white, bright accents on dark.
  const onSeries = background

  const variables: Record<string, unknown> = {
    darkMode: palette.isDark,
    background,
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    textColor: fg,
    titleColor: fg,
    lineColor: palette.muted,
    // Flowchart, class, state, ER: boxes in tints, cyan first.
    primaryColor: tint(0),
    primaryBorderColor: series[0],
    primaryTextColor: fg,
    secondaryColor: tint(1),
    secondaryBorderColor: series[1],
    secondaryTextColor: fg,
    tertiaryColor: tint(2),
    tertiaryBorderColor: series[2],
    tertiaryTextColor: fg,
    mainBkg: tint(0),
    nodeBorder: series[0],
    nodeTextColor: fg,
    clusterBkg: palette.surface,
    clusterBorder: palette.border,
    edgeLabelBackground: background,
    // Notes (sequence, state): amber, the fourth color.
    noteBkgColor: tint(3),
    noteBorderColor: series[3],
    noteTextColor: fg,
    // Sequence diagrams.
    actorBkg: tint(0),
    actorBorder: series[0],
    actorTextColor: fg,
    actorLineColor: palette.muted,
    signalColor: fg,
    signalTextColor: fg,
    labelBoxBkgColor: tint(0),
    labelBoxBorderColor: series[0],
    labelTextColor: fg,
    loopTextColor: fg,
    activationBkgColor: tint(1),
    activationBorderColor: series[1],
    sequenceNumberColor: onSeries,
    // Pie charts: full palette in order.
    pieStrokeColor: background,
    pieOuterStrokeColor: palette.border,
    pieSectionTextColor: onSeries,
    pieTitleTextColor: fg,
    pieLegendTextColor: fg,
    // Gantt.
    sectionBkgColor: tint(0),
    altSectionBkgColor: background,
    sectionBkgColor2: tint(1),
    taskBkgColor: series[0],
    taskBorderColor: series[0],
    taskTextColor: onSeries,
    taskTextLightColor: onSeries,
    taskTextOutsideColor: fg,
    activeTaskBkgColor: series[1],
    activeTaskBorderColor: series[1],
    doneTaskBkgColor: palette.muted,
    doneTaskBorderColor: palette.muted,
    critBkgColor: series[2],
    critBorderColor: series[2],
    gridColor: palette.border,
    todayLineColor: series[1],
    // xychart-beta.
    xyChart: {
      backgroundColor: background,
      titleColor: fg,
      xAxisLabelColor: fg,
      xAxisTitleColor: fg,
      xAxisTickColor: palette.muted,
      xAxisLineColor: palette.muted,
      yAxisLabelColor: fg,
      yAxisTitleColor: fg,
      yAxisTickColor: palette.muted,
      yAxisLineColor: palette.muted,
      plotColorPalette: series.join(','),
    },
  }

  // Pie slices, git branches, and the section scales of mindmap, timeline,
  // and journey diagrams: the palette in order, repeated.
  for (let at = 0; at < 12; at++) {
    variables[`pie${at + 1}`] = series[at % 6]
    variables[`cScale${at}`] = tint(at)
    variables[`cScaleLabel${at}`] = fg
    variables[`cScalePeer${at}`] = series[at % 6]
  }
  for (let at = 0; at < 8; at++) {
    variables[`git${at}`] = series[at % 6]
    variables[`gitBranchLabel${at}`] = onSeries
    variables[`fillType${at}`] = tint(at)
  }
  return variables
}
