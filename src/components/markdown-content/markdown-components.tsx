import { useMemo, type ReactNode, type ComponentProps } from 'react'
import { MermaidBlock } from './mermaid-block'
import { CodeBlock } from './code-block'

interface UseMarkdownComponentsOptions {
  compact?: boolean
  flat?: boolean
}

interface CodeProps {
  className?: string
  children: ReactNode
  node?: { position?: { start: { line: number } } }
  [key: string]: unknown
}

type PropsWithChildren = { children?: ReactNode; start?: number; [key: string]: unknown }

export function useMarkdownComponents({
  compact = false,
  flat = false,
}: UseMarkdownComponentsOptions) {
  return useMemo(() => {
    const components = {
      code(props: CodeProps) {
        const { className, children, node, ...rest } = props
        const languageMatch = /language-([\w-+]+)/.exec(className || '')
        const codeContent = String(children).replace(/\n$/, '')
        const isMultiline = codeContent.includes('\n')
        const isCodeBlock = node?.position && (languageMatch || isMultiline)

        if (isCodeBlock) {
          const language = languageMatch ? languageMatch[1] : ''

          if (language === 'mermaid') {
            return <MermaidBlock code={codeContent} flat={flat} />
          }

          return <CodeBlock language={language} code={codeContent} flat={flat} />
        }

        return (
          <code
            className={
              flat
                ? 'px-1 py-0.5 rounded-md bg-muted text-xs font-mono'
                : 'px-1.5 py-0.5 rounded-md bg-muted text-sm font-mono'
            }
            {...rest}
          >
            {children}
          </code>
        )
      },

      pre(props: PropsWithChildren) {
        return <>{props.children}</>
      },
      p(props: PropsWithChildren) {
        return <p className={flat ? 'leading-relaxed' : 'mb-2 last:mb-0'}>{props.children}</p>
      },

      ul(props: PropsWithChildren) {
        return (
          <ul className={flat ? 'list-disc pl-5 space-y-0.5' : 'list-disc pl-5 mb-2 space-y-1'}>
            {props.children}
          </ul>
        )
      },
      ol(props: PropsWithChildren) {
        return (
          <ol
            className={flat ? 'list-decimal pl-5 space-y-0.5' : 'list-decimal pl-5 mb-2 space-y-1'}
            start={props.start}
          >
            {props.children}
          </ol>
        )
      },
      li(props: PropsWithChildren) {
        return <li className="pl-1">{props.children}</li>
      },

      blockquote(props: PropsWithChildren) {
        return (
          <blockquote
            className={
              flat
                ? 'border-l-4 border-muted-foreground/30 pl-4 italic'
                : 'border-l-4 border-muted-foreground/30 pl-4 italic my-2'
            }
          >
            {props.children}
          </blockquote>
        )
      },
      h1(props: PropsWithChildren) {
        const cls = flat
          ? 'font-bold leading-relaxed'
          : compact
            ? 'text-xl font-bold mb-2 mt-3'
            : 'text-2xl font-bold mb-2 mt-4'
        return <h1 className={cls}>{props.children}</h1>
      },
      h2(props: PropsWithChildren) {
        const cls = flat
          ? 'font-bold leading-relaxed'
          : compact
            ? 'text-lg font-bold mb-2 mt-2'
            : 'text-xl font-bold mb-2 mt-3'
        return <h2 className={cls}>{props.children}</h2>
      },
      h3(props: PropsWithChildren) {
        const cls = flat
          ? 'font-bold leading-relaxed'
          : compact
            ? 'text-base font-bold mb-2 mt-2'
            : 'text-lg font-bold mb-2 mt-2'
        return <h3 className={cls}>{props.children}</h3>
      },
      h4(props: PropsWithChildren) {
        const cls = flat
          ? 'font-semibold leading-relaxed'
          : compact
            ? 'text-sm font-bold mb-2 mt-2'
            : 'text-base font-bold mb-2 mt-2'
        return <h4 className={cls}>{props.children}</h4>
      },
      h5(props: PropsWithChildren) {
        return (
          <h5 className={flat ? 'font-semibold leading-relaxed' : 'text-sm font-bold mb-1 mt-2'}>
            {props.children}
          </h5>
        )
      },
      h6(props: PropsWithChildren) {
        const cls = flat
          ? 'font-semibold leading-relaxed'
          : compact
            ? 'text-xs font-semibold mb-1 mt-2'
            : 'text-sm font-semibold mb-1 mt-2'
        return <h6 className={cls}>{props.children}</h6>
      },

      a(props: ComponentProps<'a'>) {
        return (
          <a
            href={props.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            {props.children}
          </a>
        )
      },

      img(props: ComponentProps<'img'>) {
        return (
          <img
            src={props.src}
            alt={props.alt || ''}
            className="max-w-full h-auto rounded-md my-2"
            loading="lazy"
          />
        )
      },

      table(props: PropsWithChildren) {
        return (
          <div className={flat ? 'overflow-x-auto' : 'overflow-x-auto my-2'}>
            <table className="min-w-full border-collapse border border-border">
              {props.children}
            </table>
          </div>
        )
      },
      thead(props: PropsWithChildren) {
        return <thead className="bg-muted">{props.children}</thead>
      },
      tbody(props: PropsWithChildren) {
        return <tbody>{props.children}</tbody>
      },
      tr(props: PropsWithChildren) {
        return <tr className="border-b border-border">{props.children}</tr>
      },
      th(props: PropsWithChildren) {
        return (
          <th
            className={
              flat
                ? 'border border-border px-3 py-1 text-left text-xs font-semibold'
                : 'border border-border px-3 py-1 text-left text-sm font-semibold'
            }
          >
            {props.children}
          </th>
        )
      },
      td(props: PropsWithChildren) {
        return (
          <td
            className={
              flat
                ? 'border border-border px-3 py-1 text-xs'
                : 'border border-border px-3 py-1 text-sm'
            }
          >
            {props.children}
          </td>
        )
      },

      hr() {
        return <hr className={flat ? 'my-1 border-border' : 'my-4 border-border'} />
      },

      input(props: ComponentProps<'input'>) {
        if (props.type === 'checkbox') {
          return (
            <input
              type="checkbox"
              checked={props.checked}
              disabled={props.disabled}
              className="mr-2 h-4 w-4 rounded border-border"
              readOnly
            />
          )
        }
        return <input type={props.type} />
      },

      del(props: PropsWithChildren) {
        return <del className="text-muted-foreground line-through">{props.children}</del>
      },
    }
    return components
  }, [compact, flat])
}
