import type { ModelVendor } from "@/components/model-list"
import type { AssistantGroup } from "@/components/assistant-list"
import gptAvatar from "@/assets/avatars/models/gpt.png"
import claudeAvatar from "@/assets/avatars/models/claude.png"
import geminiAvatar from "@/assets/avatars/models/gemini.png"
import llamaAvatar from "@/assets/avatars/models/llama.png"

export const aiModels: ModelVendor[] = [
  {
    id: "openai",
    name: "OpenAI",
    models: [
      {
        id: "gpt-4-turbo",
        name: "GPT-4 Turbo",
        modelId: "gpt-4-turbo-preview",
        logo: gptAvatar,
        isStarred: true,
      },
      {
        id: "gpt-4",
        name: "GPT-4",
        modelId: "gpt-4",
        logo: gptAvatar,
        isStarred: false,
      },
      {
        id: "gpt-3.5-turbo",
        name: "GPT-3.5 Turbo",
        modelId: "gpt-3.5-turbo",
        logo: gptAvatar,
        isStarred: false,
      },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: [
      {
        id: "claude-3-opus",
        name: "Claude 3 Opus",
        modelId: "claude-3-opus-20240229",
        logo: claudeAvatar,
        isStarred: false,
      },
      {
        id: "claude-3-sonnet",
        name: "Claude 3 Sonnet",
        modelId: "claude-3-sonnet-20240229",
        logo: claudeAvatar,
        isStarred: true,
      },
      {
        id: "claude-3-haiku",
        name: "Claude 3 Haiku",
        modelId: "claude-3-haiku-20240307",
        logo: claudeAvatar,
        isStarred: false,
      },
    ],
  },
  {
    id: "google",
    name: "Google",
    models: [
      {
        id: "gemini-pro",
        name: "Gemini Pro",
        modelId: "gemini-pro",
        logo: geminiAvatar,
        isStarred: false,
      },
      {
        id: "gemini-ultra",
        name: "Gemini Ultra",
        modelId: "gemini-1.5-pro-latest",
        logo: geminiAvatar,
        isStarred: false,
      },
    ],
  },
  {
    id: "meta",
    name: "Meta",
    models: [
      {
        id: "llama-2-70b",
        name: "Llama 2 70B",
        modelId: "llama-2-70b-chat",
        logo: llamaAvatar,
        isStarred: false,
      },
      {
        id: "llama-2-13b",
        name: "Llama 2 13B",
        modelId: "llama-2-13b-chat",
        logo: llamaAvatar,
        isStarred: false,
      },
    ],
  },
]

export const assistantGroups: AssistantGroup[] = [
  {
    id: "work",
    name: "Work",
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
          hasTools: false,
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
          hasTools: true,
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
          hasTools: true,
        },
        isStarred: false,
      },
    ],
  },
  {
    id: "personal",
    name: "Personal",
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
          hasTools: false,
        },
        isStarred: true,
      },
      {
        id: "assistant-5",
        name: "Writing Coach",
        avatarBg: "#f59e0b",
        avatarText: "✍️",
        capabilities: {
          modelLogo: gptAvatar,
          hasModel: true,
          hasFiles: false,
          hasKnowledgeBase: true,
          hasTools: false,
        },
        isStarred: false,
      },
      {
        id: "assistant-6",
        name: "Language Tutor",
        avatarBg: "#ec4899",
        avatarText: "🌐",
        capabilities: {
          modelLogo: llamaAvatar,
          hasModel: true,
          hasFiles: true,
          hasKnowledgeBase: true,
          hasTools: true,
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
        id: "assistant-7",
        name: "Math Tutor",
        avatarBg: "#14b8a6",
        avatarText: "🔢",
        capabilities: {
          modelLogo: geminiAvatar,
          hasModel: true,
          hasFiles: false,
          hasKnowledgeBase: true,
          hasTools: false,
        },
        isStarred: false,
      },
      {
        id: "assistant-8",
        name: "Science Explainer",
        avatarBg: "#06b6d4",
        avatarText: "🔬",
        capabilities: {
          modelLogo: claudeAvatar,
          hasModel: true,
          hasFiles: true,
          hasKnowledgeBase: true,
          hasTools: false,
        },
        isStarred: false,
      },
    ],
  },
]

