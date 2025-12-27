import { useMemo, type ReactNode, type ComponentProps } from 'react'
import { MermaidBlock } from './mermaid-block'
import { CodeBlock } from './code-block'

interface UseMarkdownComponentsOptions {
  compact?: boolean
}

interface CodeProps {
  className?: string
  children: ReactNode
  node?: { position?: { start: { line: number } } }
  [key: string]: unknown
}

type PropsWithChildren = { children?: ReactNode; start?: number; [key: string]: unknown }

export function useMarkdownComponents({ compact = false }: UseMarkdownComponentsOptions) {
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
            return <MermaidBlock code={codeContent} />
          }

          return <CodeBlock language={language} code={codeContent} />
        }

        return (
          <code className="px-1.5 py-0.5 rounded-md bg-muted text-sm font-mono" {...rest}>
            {children}
          </code>
        )
      },

      pre(props: PropsWithChildren) {
        return <>{props.children}</>
      },

      p(props: PropsWithChildren) {
        return <p className="mb-2 last:mb-0">{props.children}</p>
      },

      ul(props: PropsWithChildren) {
        return <ul className="list-disc pl-5 mb-2 space-y-1">{props.children}</ul>
      },
      ol(props: PropsWithChildren) {
        return (
          <ol className="list-decimal pl-5 mb-2 space-y-1" start={props.start}>
            {props.children}
          </ol>
        )
      },
      li(props: PropsWithChildren) {
        return <li className="pl-1">{props.children}</li>
      },

      blockquote(props: PropsWithChildren) {
        return (
          <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic my-2">
            {props.children}
          </blockquote>
        )
      },

      h1(props: PropsWithChildren) {
        return (
          <h1 className={compact ? 'text-xl font-bold mb-2 mt-3' : 'text-2xl font-bold mb-2 mt-4'}>
            {props.children}
          </h1>
        )
      },
      h2(props: PropsWithChildren) {
        return (
          <h2 className={compact ? 'text-lg font-bold mb-2 mt-2' : 'text-xl font-bold mb-2 mt-3'}>
            {props.children}
          </h2>
        )
      },
      h3(props: PropsWithChildren) {
        return (
          <h3 className={compact ? 'text-base font-bold mb-2 mt-2' : 'text-lg font-bold mb-2 mt-2'}>
            {props.children}
          </h3>
        )
      },
      h4(props: PropsWithChildren) {
        return (
          <h4 className={compact ? 'text-sm font-bold mb-2 mt-2' : 'text-base font-bold mb-2 mt-2'}>
            {props.children}
          </h4>
        )
      },
      h5(props: PropsWithChildren) {
        return <h5 className="text-sm font-bold mb-1 mt-2">{props.children}</h5>
      },
      h6(props: PropsWithChildren) {
        return (
          <h6
            className={
              compact ? 'text-xs font-semibold mb-1 mt-2' : 'text-sm font-semibold mb-1 mt-2'
            }
          >
            {props.children}
          </h6>
        )
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
          <div className="overflow-x-auto my-2">
            <table className="min-w-full border-collapse border border-border">{props.children}</table>
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
          <th className="border border-border px-3 py-1 text-left text-sm font-semibold">
            {props.children}
          </th>
        )
      },
      td(props: PropsWithChildren) {
        return <td className="border border-border px-3 py-1 text-sm">{props.children}</td>
      },

      hr() {
        return <hr className="my-4 border-border" />
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
  }, [compact])
}
