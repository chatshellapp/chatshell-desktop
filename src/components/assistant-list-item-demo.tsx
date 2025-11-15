import * as React from "react"
import { AssistantList, Assistant, AssistantGroup } from "@/components/assistant-list"
import gptAvatar from "@/assets/models/gpt.png"
import claudeAvatar from "@/assets/models/claude.png"
import geminiAvatar from "@/assets/models/gemini.png"

/**
 * Demo component showcasing the AssistantList component
 */
export function AssistantListDemo() {
  const [selectedAssistantId, setSelectedAssistantId] = React.useState<string>("assistant-1")
  const [assistantGroups, setAssistantGroups] = React.useState<AssistantGroup[]>([
    {
      id: "work",
      name: "Work Assistants",
      defaultOpen: true,
      assistants: [
        {
          id: "assistant-1",
          name: "Code Review Assistant",
          avatarBg: "#3b82f6",
          avatarText: "💻",
          capabilities: {
            modelLogo: gptAvatar,
            hasModel: true,
            hasFiles: true,
            hasKnowledgeBase: true,
            hasMcpServer: false,
          },
          isStarred: true,
        },
        {
          id: "assistant-2",
          name: "Documentation Writer",
          avatarBg: "#10b981",
          avatarText: "📝",
          capabilities: {
            modelLogo: claudeAvatar,
            hasModel: true,
            hasFiles: true,
            hasKnowledgeBase: true,
            hasMcpServer: true,
          },
          isStarred: false,
        },
        {
          id: "assistant-3",
          name: "Bug Tracker",
          avatarBg: "#ef4444",
          avatarText: "🐛",
          capabilities: {
            modelLogo: geminiAvatar,
            hasModel: true,
            hasFiles: false,
            hasKnowledgeBase: false,
            hasMcpServer: true,
          },
          isStarred: false,
        },
      ],
    },
    {
      id: "personal",
      name: "Personal Assistants",
      defaultOpen: false,
      assistants: [
        {
          id: "assistant-4",
          name: "Research Helper",
          avatarBg: "#8b5cf6",
          avatarText: "🔍",
          capabilities: {
            modelLogo: claudeAvatar,
            hasModel: true,
            hasFiles: true,
            hasKnowledgeBase: true,
            hasMcpServer: false,
          },
          isStarred: true,
        },
        {
          id: "assistant-5",
          name: "Writing Coach",
          avatarBg: "#f59e0b",
          avatarText: "CR",
          capabilities: {
            modelLogo: gptAvatar,
            hasModel: true,
            hasFiles: false,
            hasKnowledgeBase: true,
            hasMcpServer: false,
          },
          isStarred: false,
        },
      ],
    },
    {
      id: "learning",
      name: "Learning",
      defaultOpen: false,
      assistants: [
        {
          id: "assistant-6",
          name: "Language Tutor",
          avatarBg: "#ec4899",
          avatarText: "🌐",
          capabilities: {
            modelLogo: geminiAvatar,
            hasModel: true,
            hasFiles: true,
            hasKnowledgeBase: true,
            hasMcpServer: true,
          },
          isStarred: false,
        },
      ],
    },
  ])

  const handleAssistantClick = (assistant: Assistant) => {
    console.log("Assistant clicked:", assistant)
    setSelectedAssistantId(assistant.id)
  }

  const handleAssistantSettings = (assistant: Assistant) => {
    console.log("Assistant settings:", assistant)
  }

  const handleAssistantStarToggle = (assistant: Assistant) => {
    console.log("Toggle star for assistant:", assistant)
    setAssistantGroups((prevGroups) =>
      prevGroups.map((group) => ({
        ...group,
        assistants: group.assistants.map((a) =>
          a.id === assistant.id ? { ...a, isStarred: !a.isStarred } : a
        ),
      }))
    )
  }

  const handleGroupSettings = (group: AssistantGroup) => {
    console.log("Group settings:", group)
  }

  return (
    <div className="w-80 p-4 border rounded-lg">
      <h2 className="text-lg font-semibold mb-4">Assistants</h2>
      <AssistantList
        groups={assistantGroups}
        selectedAssistantId={selectedAssistantId}
        onAssistantClick={handleAssistantClick}
        onAssistantSettings={handleAssistantSettings}
        onAssistantStarToggle={handleAssistantStarToggle}
        onGroupSettings={handleGroupSettings}
      />
    </div>
  )
}

