import { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'

/**
 * Allowlist for HTML inside Markdown (`rehype-raw` turns raw HTML in
 * messages, web-fetch results and tool output into real elements).
 *
 * GitHub's schema (`defaultSchema`) drops scripts, event handlers, iframes,
 * forms, styles and `javascript:` URLs while keeping ordinary formatting
 * (`<details>`, `<kbd>`, `<sup>`, tables, task lists, footnotes). On top of
 * it this keeps what the app's own plugins need:
 *
 * `math-inline` / `math-display` on `code`: remark-math's markers, read by
 * rehype-katex, which runs after sanitizing so KaTeX output is untouched.
 * URLs are additionally filtered by react-markdown's `defaultUrlTransform`
 * (http, https, mailto, irc, xmpp and relative only).
 */
export const markdownSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
  },
}
