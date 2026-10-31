export function HighlightedSnippet({ text }: { text: string }) {
  const parts = text.split(/(<mark>.*?<\/mark>)/g)
  return (
    <span>
      {parts.map((part, i) =>
        part.startsWith('<mark>') ? (
          <mark key={i} className="bg-highlight text-foreground rounded-sm px-0.5 font-medium">
            {part.replace(/<\/?mark>/g, '')}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  )
}
