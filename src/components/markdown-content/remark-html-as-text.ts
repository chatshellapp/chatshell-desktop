interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
}

function convert(node: MdNode): void {
  if (node.type === 'html') {
    node.type = 'text'
    return
  }
  node.children?.forEach(convert)
}

/**
 * Render raw HTML in Markdown as literal text instead of elements.
 *
 * Used where the content is user material that must be shown verbatim (e.g.
 * translations): unclosed `<!--`, `<script>`, `<plaintext>` and similar
 * constructs would otherwise hide everything after them.
 */
export default function remarkHtmlAsText() {
  return (tree: MdNode) => convert(tree)
}
