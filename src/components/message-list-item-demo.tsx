import { MessageListItem, MessageListItemGroup } from "./message-list-item"
import gptAvatar from "@/assets/models/gpt.png"
import claudeAvatar from "@/assets/models/claude.png"
import geminiAvatar from "@/assets/models/gemini.png"
import llamaAvatar from "@/assets/models/llama.png"
import { useState } from "react"

/**
 * Demo component showing different use cases of MessageListItem
 */
export function MessageListItemDemo() {
  const [selectedId, setSelectedId] = useState<string | null>("1")

  const demoMessages = [
    {
      id: "1",
      avatars: [gptAvatar],
      summary: "React Hooks Discussion",
      timestamp: "2 mins ago",
      lastMessage:
        "useEffect is a Hook that performs side effects in functional components. It runs after every render by default...",
      avatarFallbacks: ["AI"],
    },
    {
      id: "2",
      avatars: [claudeAvatar, gptAvatar],
      summary: "Multi-Model Conversation: State Management Approaches",
      timestamp: "15 mins ago",
      lastMessage:
        "Let me help you compare the differences between these two approaches to state management in React applications.",
      avatarFallbacks: ["C", "G"],
    },
    {
      id: "3",
      avatars: [geminiAvatar],
      summary: "TypeScript Best Practices and Design Patterns for Modern Applications",
      timestamp: "1 hour ago",
      lastMessage:
        "Here are some key TypeScript patterns that will help improve your code quality and maintainability...",
      avatarFallbacks: ["GM"],
    },
    {
      id: "4",
      avatars: [llamaAvatar, claudeAvatar, gptAvatar, geminiAvatar],
      summary: "Team Discussion",
      timestamp: "3 hours ago",
      lastMessage:
        "I agree with the previous suggestions. Additionally, we should consider the performance implications...",
      avatarFallbacks: ["L", "C", "G", "GM"],
    },
    {
      id: "5",
      avatars: [gptAvatar],
      summary: "Quick Question",
      timestamp: "Yesterday",
      lastMessage: "Sure, I can help with that!",
      avatarFallbacks: ["AI"],
    },
  ]

  return (
    <div className="w-full max-w-md p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-2">Message List Items Demo</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Click on any item to select it
        </p>
      </div>

      <MessageListItemGroup>
        {demoMessages.map((message) => (
          <MessageListItem
            key={message.id}
            avatars={message.avatars}
            summary={message.summary}
            timestamp={message.timestamp}
            lastMessage={message.lastMessage}
            avatarFallbacks={message.avatarFallbacks}
            isActive={selectedId === message.id}
            onClick={() => setSelectedId(message.id)}
          />
        ))}
      </MessageListItemGroup>

      <div className="pt-4 border-t">
        <h3 className="text-sm font-medium mb-2">Features:</h3>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>✓ 3-row layout: Title (wraps to 2 lines), Message, Timestamp + Avatars</li>
          <li>✓ Small avatars (size-5) on the right side</li>
          <li>✓ Timestamp and avatars on the same row</li>
          <li>✓ Truncated message preview with ellipsis</li>
          <li>✓ Active/selected state</li>
          <li>✓ Hover effects</li>
          <li>✓ Keyboard navigation support</li>
          <li>✓ Shows "+N" for more than 3 avatars</li>
        </ul>
      </div>
    </div>
  )
}

