// The OpenUI section of the system prompt, written by hand for ChatShell's
// four-component library (`library.ts`). It is committed into
// chatshell-agent-core (`visual_output/openui_prompt.txt`), which appends it
// to the visual-output routing rules. `__tests__/prompt.test.ts` fails when
// the committed text drifts from this file, when a signature here no longer
// matches the library, or when an example stops parsing; run it with
// UPDATE_OPENUI_PROMPT=1 to rewrite the committed copy.

/** The fence info string the model writes and the renderer matches. */
export const OPENUI_FENCE_LANGUAGE = 'openui-lang'

/** Each example is a program the test parses against the library. */
export const OPENUI_EXAMPLE_PROGRAMS: string[] = [
  `root = Chart("bar", "Quarterly revenue", quarters, [north, south], "USD thousands")
quarters = ["Q1", "Q2", "Q3", "Q4"]
north = Series("North", [120, 135, 150, 170])
south = Series("South", [90, 110, 105, 130])`,
  `root = Stats([revenue, churn])
revenue = Stat("Revenue", "$48.2k", "+8.1%", "vs last month")
churn = Stat("Churn", "1.8%", "-0.3 pt", "vs last month")`,
  `root = Chart("line", "ACME share price", days, [close], "Daily close", null, "USD")
days = ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14"]
close = Series("ACME", [41.2, 42.05, 41.7, 43.18])`,
]

/** Component signatures as taught; the test checks them against the library. */
export const OPENUI_SIGNATURES = [
  'Chart(type, title, labels, series, description?, variant?, unit?)',
  'Series(name, values, total?)',
  'Stats(items)',
  'Stat(label, value, change?, note?)',
]

const fence = (program: string) => `\`\`\`${OPENUI_FENCE_LANGUAGE}\n${program}\n\`\`\``

/** The OpenUI prompt section: deterministic and ASCII, like the rest of the
 * core prompt. */
export function generateOpenUiPrompt(): string {
  const [chart, series, stats, stat] = OPENUI_SIGNATURES
  return `OpenUI blocks: a \`\`\`${OPENUI_FENCE_LANGUAGE} fenced block renders a chart or a row of KPI cards inside your Markdown answer. Blocks only display data; nothing in them can be clicked, filled in, or sent, so ask questions and suggest next steps in prose.

Write one statement per line, \`name = Expression\`, starting with \`root = Chart(...)\` or \`root = Stats([...])\`. Arguments are positional (never \`name: value\`); optional ones (?) may be left off the end. Strings use double quotes. Define every name you use and use every name you define.

- ${chart} - type is "bar", "line", "area", "pie", "radar", or "radial". labels are the categories on the x-axis (the slices of a pie or radial chart, the axes of a radar chart). variant: "stacked" (bar, area), "horizontal" (bar, for long or many labels), "donut" (pie). For dated data, labels are ISO dates ("2026-05-11"), oldest first; line and area charts space them by date. unit is an ISO currency code ("USD") or a suffix ("%", "ms") that the axis, tooltips, and labels add to every value; write null for a variant you skip.
- ${series} - one number per label; at most 6 series, and pie and radial charts take exactly one. When every series has a total (a formatted string such as "7,324"), the chart header shows the totals as tiles the reader switches between, one series at a time.
- ${stats} - a row of 2 to 4 KPI cards.
- ${stat} - value and change are formatted strings such as "$48.2k" and "+8.1%"; note is a short comparison such as "vs last month".

${OPENUI_EXAMPLE_PROGRAMS.map(fence).join('\n\n')}

- Only use numbers from the conversation, tool results, or well-established facts; never invent data. A total is the figure the source states, or the sum when the series counts things.
- Values are plain numbers. With a unit, write them unscaled (the axis abbreviates them); without one, scale large ones and name the unit in the description ("USD thousands").
- Next to a block, state its takeaway in one prose sentence, because the block does not render on every device. Do not otherwise repeat its data in prose or in a table.
- Usually one block per answer. Open the fence at the top level, never inside a list.
`
}
