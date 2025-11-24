"use client"

import * as React from "react"
import { Bot, Command, Drama, File, Library, MessageSquare, Settings, Users, Sparkles, Plug, BookOpen, Plus } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

import { NavUser } from "@/components/nav-user"
import { Button } from "@/components/ui/button"
import { MessageListItem } from "@/components/message-list-item"
import { ModelList, type Model, type ModelVendor } from "@/components/model-list"
import { AssistantList, type Assistant, type AssistantGroup } from "@/components/assistant-list"
import { PeopleList, type Person, type PersonGroup } from "@/components/people-list"
import { PromptList, type Prompt, type PromptGroup } from "@/components/prompt-list"
import { ProviderSettingsDialog } from "@/components/provider-settings-dialog"
import { SettingsDialog } from "@/components/settings-dialog"
import { useConversationStore } from "@/stores/conversationStore"
import { useAssistantStore } from "@/stores/assistantStore"
import { useModelStore } from "@/stores/modelStore"
import { useUserStore } from "@/stores/userStore"
import { getModelLogo } from "@/lib/model-logos"
import type { ParticipantSummary } from "@/types"
import type { AvatarData } from "@/components/message-list-item"
import gptAvatar from "@/assets/avatars/models/gpt.png"
import claudeAvatar from "@/assets/avatars/models/claude.png"
import geminiAvatar from "@/assets/avatars/models/gemini.png"
import llamaAvatar from "@/assets/avatars/models/llama.png"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// This is sample data
const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      title: "Conversations",
      url: "#",
      icon: MessageSquare,
      isActive: true,
    },
    {
      title: "Contacts",
      url: "#",
      icon: Users,
      isActive: false,
    },
    {
      title: "Library",
      url: "#",
      icon: Library,
      isActive: false,
    },
    {
      title: "Settings",
      url: "#",
      icon: Settings,
      isActive: false,
    }
  ],
  conversations: [
    {
      id: "1",
      name: "Project Discussion",
      lastMessage: "Let's finalize the architecture design",
      timestamp: "2 min ago",
      unread: 3,
      avatars: [gptAvatar, claudeAvatar],
    },
    {
      id: "2",
      name: "Code Review",
      lastMessage: "LGTM, approved the PR",
      timestamp: "1 hour ago",
      unread: 0,
      avatars: [geminiAvatar],
    },
    {
      id: "3",
      name: "Bug Investigation",
      lastMessage: "Found the root cause of the issue",
      timestamp: "3 hours ago",
      unread: 1,
      avatars: [claudeAvatar, gptAvatar, geminiAvatar],
    },
    {
      id: "4",
      name: "Feature Planning",
      lastMessage: "Here's the implementation roadmap",
      timestamp: "Yesterday",
      unread: 0,
      avatars: [llamaAvatar, claudeAvatar, gptAvatar, geminiAvatar],
    },
  ],
  bots: [
    {
      id: "1",
      name: "Code Assistant",
      description: "Helps with code generation and refactoring",
      model: "GPT-4",
    },
    {
      id: "2",
      name: "Documentation Writer",
      description: "Creates comprehensive documentation",
      model: "Claude 3",
    },
    {
      id: "3",
      name: "Debug Helper",
      description: "Assists with debugging and error resolution",
      model: "GPT-3.5",
    },
    {
      id: "4",
      name: "Test Generator",
      description: "Generates unit and integration tests",
      model: "GPT-4",
    },
  ],
  assistantGroups: [
    {
      id: "work",
      name: "Work",
      defaultOpen: true,
      assistants: [
        {
          id: "assistant-1",
          name: "Jacob",
          persona: "Code Review Assistant",
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
          name: "Emily",
          persona: "Documentation Writer",
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
          name: "Michael",
          persona: "Bug Tracker",
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
      name: "Personal",
      defaultOpen: false,
      assistants: [
        {
          id: "assistant-4",
          name: "Madison",
          persona: "Research Helper",
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
          name: "Matthew",
          persona: "Writing Coach",
          avatarBg: "#f59e0b",
          avatarText: "✍️",
          capabilities: {
            modelLogo: gptAvatar,
            hasModel: true,
            hasFiles: false,
            hasKnowledgeBase: true,
            hasMcpServer: false,
          },
          isStarred: false,
        },
        {
          id: "assistant-6",
          name: "Hannah",
          persona: "Language Tutor",
          avatarBg: "#ec4899",
          avatarText: "🌐",
          capabilities: {
            modelLogo: llamaAvatar,
            hasModel: true,
            hasFiles: true,
            hasKnowledgeBase: true,
            hasMcpServer: true,
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
          name: "Joshua",
          persona: "Math Tutor",
          avatarBg: "#14b8a6",
          avatarText: "🔢",
          capabilities: {
            modelLogo: geminiAvatar,
            hasModel: true,
            hasFiles: false,
            hasKnowledgeBase: true,
            hasMcpServer: false,
          },
          isStarred: false,
        },
        {
          id: "assistant-8",
          name: "Ashley",
          persona: "Science Explainer",
          avatarBg: "#06b6d4",
          avatarText: "🔬",
          capabilities: {
            modelLogo: claudeAvatar,
            hasModel: true,
            hasFiles: true,
            hasKnowledgeBase: true,
            hasMcpServer: false,
          },
          isStarred: false,
        },
      ],
    },
  ],
  peopleGroups: [
    {
      id: "team",
      name: "Team",
      defaultOpen: true,
      people: [
        {
          id: "person-1",
          name: "Sarah Johnson",
          email: "sarah.johnson@example.com",
          phone: "+1 (555) 123-4567",
          bio: "Passionate about building products that users love",
          isStarred: true,
        },
        {
          id: "person-2",
          name: "Michael Chen",
          email: "michael.chen@example.com",
          bio: "Coffee enthusiast and open source contributor",
          isStarred: false,
        },
        {
          id: "person-3",
          name: "Emma Davis",
          email: "emma.davis@example.com",
          phone: "+1 (555) 234-5678",
          bio: "Creating delightful user experiences",
          isStarred: true,
        },
      ],
    },
    {
      id: "friends",
      name: "Friends",
      defaultOpen: false,
      people: [
        {
          id: "person-4",
          name: "Alex Martinez",
          email: "alex.martinez@example.com",
          bio: "Adventure seeker and photography lover",
          isStarred: false,
        },
        {
          id: "person-5",
          name: "Jessica Brown",
          email: "jessica.brown@example.com",
          phone: "+1 (555) 345-6789",
          bio: "Bookworm and aspiring novelist",
          isStarred: false,
        },
      ],
    },
    {
      id: "clients",
      name: "Clients",
      defaultOpen: false,
      people: [
        {
          id: "person-6",
          name: "David Wilson",
          email: "david.wilson@clientco.com",
          phone: "+1 (555) 456-7890",
          bio: "Building innovative solutions for enterprise clients",
          isStarred: false,
        },
        {
          id: "person-7",
          name: "Lisa Anderson",
          email: "lisa.anderson@acmecorp.com",
          bio: "Focused on driving digital transformation",
          isStarred: false,
        },
      ],
    },
  ],
  aiModels: [
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
  ] as ModelVendor[],
  resources: [
    {
      id: "1",
      name: "API Documentation",
      type: "Document",
      size: "2.4 MB",
      lastModified: "Today",
    },
    {
      id: "2",
      name: "Database Schema",
      type: "File",
      size: "156 KB",
      lastModified: "Yesterday",
    },
    {
      id: "3",
      name: "Design System",
      type: "Folder",
      size: "15.8 MB",
      lastModified: "2 days ago",
    },
    {
      id: "4",
      name: "Meeting Notes",
      type: "Document",
      size: "892 KB",
      lastModified: "1 week ago",
    },
  ],
  promptGroups: [
    {
      id: "development",
      name: "Development",
      defaultOpen: true,
      prompts: [
        {
          id: "1",
          name: "Code Review Template",
          content: "Standard template for code review comments",
          isStarred: true,
        },
        {
          id: "2",
          name: "Bug Report Format",
          content: "Template for reporting bugs with all necessary details",
          isStarred: false,
        },
      ],
    },
    {
      id: "documentation",
      name: "Documentation",
      defaultOpen: false,
      prompts: [
        {
          id: "3",
          name: "API Documentation",
          content: "Generate comprehensive API documentation",
          isStarred: false,
        },
        {
          id: "5",
          name: "User Guide Template",
          content: "Create user-friendly guides for end users",
          isStarred: true,
        },
      ],
    },
    {
      id: "testing",
      name: "Testing",
      defaultOpen: false,
      prompts: [
        {
          id: "4",
          name: "Unit Test Generator",
          content: "Create unit tests for functions",
          isStarred: false,
        },
        {
          id: "6",
          name: "Integration Test",
          content: "Generate integration tests for API endpoints",
          isStarred: false,
        },
      ],
    },
  ] as PromptGroup[],
  files: [
    {
      id: "1",
      name: "project-requirements.pdf",
      type: "PDF",
      size: "1.2 MB",
      lastModified: "Today",
    },
    {
      id: "2",
      name: "architecture-diagram.png",
      type: "Image",
      size: "345 KB",
      lastModified: "Yesterday",
    },
    {
      id: "3",
      name: "config.json",
      type: "JSON",
      size: "12 KB",
      lastModified: "2 days ago",
    },
    {
      id: "4",
      name: "meeting-notes.md",
      type: "Markdown",
      size: "45 KB",
      lastModified: "3 days ago",
    },
  ],
  knowledgeBases: [
    {
      id: "1",
      name: "Company Handbook",
      description: "Complete company policies and procedures",
      documents: 45,
      lastUpdated: "Today",
    },
    {
      id: "2",
      name: "Technical Documentation",
      description: "All technical specifications and guides",
      documents: 128,
      lastUpdated: "Yesterday",
    },
    {
      id: "3",
      name: "Product Knowledge",
      description: "Product features and user guides",
      documents: 67,
      lastUpdated: "1 week ago",
    },
    {
      id: "4",
      name: "Customer Support",
      description: "FAQs and support responses",
      documents: 92,
      lastUpdated: "2 weeks ago",
    },
  ],
  tools: [
    {
      id: "1",
      name: "GitHub Integration",
      description: "Access repositories, issues, and pull requests",
      status: "connected",
      lastSync: "5 min ago",
    },
    {
      id: "2",
      name: "Slack Workspace",
      description: "Read and send messages to channels",
      status: "connected",
      lastSync: "10 min ago",
    },
    {
      id: "3",
      name: "Jira Board",
      description: "Manage tickets and sprint planning",
      status: "disconnected",
      lastSync: "2 hours ago",
    },
    {
      id: "4",
      name: "Google Drive",
      description: "Access and manage documents",
      status: "connected",
      lastSync: "1 hour ago",
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  // Note: I'm using state to show active item.
  // IRL you should use the url/router.
  const [activeItem, setActiveItem] = React.useState(data.navMain[0])
  const [selectedPersonId, setSelectedPersonId] = React.useState<string | null>("person-1")
  const [peopleGroups, setPeopleGroups] = React.useState<PersonGroup[]>(data.peopleGroups)
  const [selectedPromptId, setSelectedPromptId] = React.useState<string | null>("1")
  const [promptGroups, setPromptGroups] = React.useState<PromptGroup[]>(data.promptGroups)
  const [providerDialogOpen, setProviderDialogOpen] = React.useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = React.useState(false)
  const [activeContactsTab, setActiveContactsTab] = React.useState("models")
  const [activeLibraryTab, setActiveLibraryTab] = React.useState("prompts")
  const { setOpen } = useSidebar()
  
  // Store participants for all conversations
  const [conversationParticipantsMap, setConversationParticipantsMap] = React.useState<Map<string, any[]>>(new Map())
  
  // Get conversation store functions and state - use granular selectors
  const conversations = useConversationStore((state) => state.conversations)
  const currentConversation = useConversationStore((state) => state.currentConversation)
  const createConversation = useConversationStore((state) => state.createConversation)
  const setCurrentConversation = useConversationStore((state) => state.setCurrentConversation)
  const loadConversations = useConversationStore((state) => state.loadConversations)
  const selectConversation = useConversationStore((state) => state.selectConversation)
  const selectedModel = useConversationStore((state) => state.selectedModel)
  const selectedAssistant = useConversationStore((state) => state.selectedAssistant)
  const setSelectedModel = useConversationStore((state) => state.setSelectedModel)
  const setSelectedAssistant = useConversationStore((state) => state.setSelectedAssistant)

  // Import user store - use granular selectors
  const selfUser = useUserStore((state) => state.selfUser)
  const loadSelfUser = useUserStore((state) => state.loadSelfUser)
  
  // Get assistant store functions and state - use real data instead of mock
  const assistants = useAssistantStore((state) => state.assistants)
  const updateAssistant = useAssistantStore((state) => state.updateAssistant)
  
  // Get model store functions and state - use real data instead of mock
  const models = useModelStore((state) => state.models)
  const providers = useModelStore((state) => state.providers)
  const getModelById = useModelStore((state) => state.getModelById)
  const updateModel = useModelStore((state) => state.updateModel)
  
  // Load self user when component mounts
  React.useEffect(() => {
    loadSelfUser()
  }, [loadSelfUser])

  // Load conversations when component mounts
  React.useEffect(() => {
    loadConversations()
  }, [loadConversations])

  // Load participants for all conversations using the new summary API
  React.useEffect(() => {
    const loadAllParticipants = async () => {
      if (conversations.length === 0 || !selfUser) {
        console.log('[Load Participants] No conversations to load or self user not loaded')
        return
      }
      
      console.log('[Load Participants] Loading participant summaries for', conversations.length, 'conversations')
      const participantsMap = new Map()
      
      // Load participant summaries for each conversation
      await Promise.all(
        conversations.map(async (conversation) => {
          try {
            const participants = await invoke<ParticipantSummary[]>('get_conversation_participant_summary', { 
              conversationId: conversation.id,
              currentUserId: selfUser.id
            })
            console.log(`[Load Participants] Conversation ${conversation.id}:`, participants)
            participantsMap.set(conversation.id, participants)
          } catch (error) {
            console.error(`[Load Participants] Failed to load participants for conversation ${conversation.id}:`, error)
            participantsMap.set(conversation.id, [])
          }
        })
      )
      
      console.log('[Load Participants] participantsMap:', participantsMap)
      setConversationParticipantsMap(participantsMap)
    }
    
    loadAllParticipants()
  }, [conversations, selfUser])

  // Function to refresh participants for a specific conversation
  const refreshConversationParticipants = React.useCallback(async (conversationId: string) => {
    if (!selfUser) return
    
    try {
      console.log('[Refresh Participants] Refreshing for conversation:', conversationId)
      const participants = await invoke<ParticipantSummary[]>('get_conversation_participant_summary', { 
        conversationId: conversationId,
        currentUserId: selfUser.id
      })
      console.log('[Refresh Participants] Updated participants:', participants)
      
      // Update the map with new participants
      setConversationParticipantsMap(prev => {
        const newMap = new Map(prev)
        newMap.set(conversationId, participants)
        return newMap
      })
    } catch (error) {
      console.error('[Refresh Participants] Failed to refresh participants:', error)
    }
  }, [selfUser])

  // Listen for chat-complete event to refresh participants and conversation list when new messages are sent
  React.useEffect(() => {
    console.log('[Participants Event] Setting up chat-complete listener')
    
    const unlistenComplete = listen('chat-complete', (event: any) => {
      console.log('[Participants Event] Received chat-complete event:', event.payload)
      if (event.payload.conversation_id) {
        // Refresh participants for this conversation after a short delay
        // to ensure the backend has finished adding participants
        setTimeout(() => {
          refreshConversationParticipants(event.payload.conversation_id)
          // Reload conversations to update last_message
          loadConversations()
        }, 100)
      }
    })

    return () => {
      console.log('[Participants Event] Cleaning up chat-complete listener')
      unlistenComplete.then(fn => fn())
    }
  }, [refreshConversationParticipants, loadConversations])

  // Memoize vendors list - must be at top level to avoid hook ordering issues
  const vendorsList = React.useMemo(() => {
    // Convert flat models and providers to grouped format
    if (providers.length === 0) return []
    
    // Group models by provider
    return providers.map((provider: any) => {
      const providerModels = models
        .filter((m: any) => m.provider_id === provider.id)
        .map((m: any) => ({
          id: m.id,
          name: m.name,
          modelId: m.model_id,
          logo: getModelLogo(m), // Use dynamic model logo resolution
          isStarred: m.is_starred || false,
        }))
      
      return {
        id: provider.id,
        name: provider.name,
        models: providerModels,
      }
    }).filter((vendor: any) => vendor.models.length > 0)
  }, [models, providers])

  // Memoize assistant groups - must be at top level to avoid hook ordering issues
  const assistantGroups = React.useMemo(() => {
    // Convert flat assistants list to grouped format
    if (assistants.length === 0) return []
    return [{
      id: "all",
      name: "Assistants",
      defaultOpen: true,
      assistants: assistants.map((a: any) => {
        // Get model logo for the assistant's model
        const assistantModel = getModelById(a.model_id)
        const modelLogo = assistantModel ? getModelLogo(assistantModel) : undefined
        
        return {
          id: a.id,
          name: a.name,
          modelName: assistantModel?.name,
          persona: a.system_prompt?.substring(0, 50) + '...' || 'Custom Assistant',
          avatarBg: a.avatar_bg || '#3b82f6',
          avatarText: a.avatar_text || a.name.charAt(0),
          capabilities: {
            modelLogo: modelLogo, // Use dynamic model logo resolution
            hasModel: true,
            hasFiles: false,
            hasKnowledgeBase: false,
            hasMcpServer: false,
          },
          isStarred: a.is_starred || false,
        }
      })
    }]
  }, [assistants, getModelById])

  const handleModelClick = async (model: any) => {
    console.log("Model selected:", model.name)
    // Find the real model from store
    const realModel = models.find((m: any) => m.id === model.id)
    if (!realModel) return
    
    try {
      // Check if the latest conversation has any messages
      let targetConversation = null
      
      if (conversations.length > 0) {
        // Get the most recent conversation (first one in the list)
        const latestConversation = conversations[0]
        
        // Check if it has any messages
        const messages = await invoke<any[]>('list_messages_by_conversation', {
          conversationId: latestConversation.id
        })
        
        if (messages.length === 0) {
          // Use the latest empty conversation
          targetConversation = latestConversation
          console.log("Using latest empty conversation:", latestConversation.id)
        }
      }
      
      // If no empty conversation found, create a new one
      if (!targetConversation) {
        console.log('Creating new conversation for model...')
        targetConversation = await createConversation("New Conversation")
        console.log("Created new conversation:", targetConversation)
      }
      
      // Set the selected model
      setSelectedModel(realModel)
      
      // Set the conversation as current
      setCurrentConversation(targetConversation)
      
      // Switch to conversations view if not already there
      if (activeItem?.title !== 'Conversations') {
        setActiveItem(data.navMain[0]) // Conversations is the first item
      }
    } catch (error) {
      console.error("Failed to handle model click:", error)
      alert(`Failed to select model: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleModelSettings = (model: Model) => {
    console.log("Model settings:", model)
    // Add your model settings logic here
  }

  const handleModelStarToggle = async (model: Model) => {
    console.log("Toggle star for model:", model)
    // Find the real model from store
    const realModel = models.find((m: any) => m.id === model.id)
    if (realModel) {
      try {
        await updateModel(realModel.id, {
          name: realModel.name,
          provider_id: realModel.provider_id,
          model_id: realModel.model_id,
          description: realModel.description,
          is_starred: !realModel.is_starred,
        })
      } catch (error) {
        console.error("Failed to toggle star:", error)
      }
    }
  }

  const handleVendorSettings = (vendor: ModelVendor) => {
    console.log("Vendor settings:", vendor)
    // Add your vendor settings logic here
  }

  const handleAddProvider = () => {
    setProviderDialogOpen(true)
  }

  const handleAssistantClick = async (assistant: any) => {
    console.log("Assistant selected:", assistant)
    // Find the real assistant from store
    const realAssistant = assistants.find((a: any) => a.id === assistant.id)
    if (!realAssistant) return
    
    try {
      // Check if the latest conversation has any messages
      let targetConversation = null
      
      if (conversations.length > 0) {
        // Get the most recent conversation (first one in the list)
        const latestConversation = conversations[0]
        
        // Check if it has any messages
        const messages = await invoke<any[]>('list_messages_by_conversation', {
          conversationId: latestConversation.id
        })
        
        if (messages.length === 0) {
          // Use the latest empty conversation
          targetConversation = latestConversation
          console.log("Using latest empty conversation:", latestConversation.id)
        }
      }
      
      // If no empty conversation found, create a new one
      if (!targetConversation) {
        console.log('Creating new conversation for assistant...')
        targetConversation = await createConversation("New Conversation")
        console.log("Created new conversation:", targetConversation)
      }
      
      // Set the selected assistant
      setSelectedAssistant(realAssistant)
      console.log("Set selected assistant:", realAssistant.name)
      
      // Set the conversation as current
      setCurrentConversation(targetConversation)
      
      // Switch to conversations view if not already there
      if (activeItem?.title !== 'Conversations') {
        setActiveItem(data.navMain[0]) // Conversations is the first item
      }
    } catch (error) {
      console.error("Failed to handle assistant click:", error)
      alert(`Failed to select assistant: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleAssistantSettings = (assistant: Assistant) => {
    console.log("Assistant settings:", assistant)
    // Add your assistant settings logic here
  }

  const handleAssistantStarToggle = async (assistant: any) => {
    console.log("Toggle star for assistant:", assistant)
    // Find the real assistant from store
    const realAssistant = assistants.find((a: any) => a.id === assistant.id)
    if (realAssistant) {
      try {
        await updateAssistant(realAssistant.id, {
          name: realAssistant.name,
          system_prompt: realAssistant.system_prompt,
          model_id: realAssistant.model_id,
          avatar_bg: realAssistant.avatar_bg,
          avatar_text: realAssistant.avatar_text,
          is_starred: !realAssistant.is_starred,
        })
      } catch (error) {
        console.error("Failed to toggle star:", error)
      }
    }
  }

  const handleGroupSettings = (group: AssistantGroup) => {
    console.log("Group settings:", group)
    // Add your group settings logic here
  }

  const handleAddAssistant = () => {
    console.log("Add assistant clicked")
    // Add your add assistant logic here
  }

  const handlePersonClick = (person: Person) => {
    console.log("Person selected:", person)
    setSelectedPersonId(person.id)
  }

  const handlePersonSettings = (person: Person) => {
    console.log("Person settings:", person)
    // Add your person settings logic here
  }

  const handlePersonStarToggle = (person: Person) => {
    console.log("Toggle star for person:", person)
    setPeopleGroups(prevGroups =>
      prevGroups.map(group => ({
        ...group,
        people: group.people.map(p =>
          p.id === person.id ? { ...p, isStarred: !p.isStarred } : p
        ),
      }))
    )
  }

  const handlePersonGroupSettings = (group: PersonGroup) => {
    console.log("Person group settings:", group)
    // Add your person group settings logic here
  }

  const handleAddPerson = () => {
    console.log("Add person clicked")
    // Add your add person logic here
  }

  const handlePromptClick = (prompt: Prompt) => {
    console.log("Prompt selected:", prompt)
    setSelectedPromptId(prompt.id)
  }

  const handlePromptSettings = (prompt: Prompt) => {
    console.log("Prompt settings:", prompt)
    // Add your prompt settings logic here
  }

  const handlePromptStarToggle = (prompt: Prompt) => {
    console.log("Toggle star for prompt:", prompt)
    setPromptGroups(prevGroups =>
      prevGroups.map(group => ({
        ...group,
        prompts: group.prompts.map(p =>
          p.id === prompt.id ? { ...p, isStarred: !p.isStarred } : p
        ),
      }))
    )
  }

  const handlePromptGroupSettings = (group: PromptGroup) => {
    console.log("Prompt group settings:", group)
    // Add your prompt group settings logic here
  }

  const handleAddPrompt = () => {
    console.log("Add prompt clicked")
    // Add your add prompt logic here
  }

  const handleNewConversation = async () => {
    console.log('[handleNewConversation] called')
    console.log('[handleNewConversation] selectedModel:', selectedModel?.name)
    console.log('[handleNewConversation] selectedAssistant:', selectedAssistant?.name)
    
    try {
      // Save current selection before creating conversation
      const currentModel = selectedModel
      const currentAssistant = selectedAssistant
      
      // Create a new conversation
      console.log('Creating new conversation...')
      const newConversation = await createConversation("New Conversation")
      console.log("Created new conversation:", newConversation)
      
      // Participants will be automatically added by backend when first message is sent
      // This ensures only models/assistants that are actually used are recorded
      
      setCurrentConversation(newConversation)
      
      // Restore the selection after setting current conversation
      // This ensures the new conversation inherits the last used model/assistant
      if (currentModel) {
        console.log('[handleNewConversation] Restoring selectedModel:', currentModel.name)
        setSelectedModel(currentModel)
      } else if (currentAssistant) {
        console.log('[handleNewConversation] Restoring selectedAssistant:', currentAssistant.name)
        setSelectedAssistant(currentAssistant)
      }
      
      // Switch to conversations view if not already there
      if (activeItem?.title !== 'Conversations') {
        setActiveItem(data.navMain[0]) // Conversations is the first item
      }
    } catch (error) {
      console.error("Failed to create new conversation:", error)
      alert(`Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleConversationClick = async (conversationId: string) => {
    try {
      await selectConversation(conversationId)
    } catch (error) {
      console.error("Failed to select conversation:", error)
    }
  }

  const formatTimestamp = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins} min ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
    if (diffDays === 1) return "Yesterday"
    if (diffDays < 7) return `${diffDays} days ago`
    
    return date.toLocaleDateString()
  }

  const renderFooter = () => {
    switch (activeItem.title) {
      case "Conversations":
        return (
          <div className="px-3 pt-2 pb-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 h-9"
              onClick={handleNewConversation}
            >
              <Plus className="size-4" />
              New Conversation
            </Button>
          </div>
        )
      case "Contacts":
        switch (activeContactsTab) {
          case "models":
            return (
              <div className="px-3 pt-2 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-9"
                  onClick={handleAddProvider}
                >
                  <Plus className="size-4" />
                  Add LLM Provider
                </Button>
              </div>
            )
          case "assistants":
            return (
              <div className="px-3 pt-2 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-9"
                  onClick={handleAddAssistant}
                >
                  <Plus className="size-4" />
                  Add Assistant
                </Button>
              </div>
            )
          case "people":
            return (
              <div className="px-3 pt-2 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-9"
                  onClick={handleAddPerson}
                >
                  <Plus className="size-4" />
                  Add Contact
                </Button>
              </div>
            )
        }
        break
      case "Library":
        if (activeLibraryTab === "prompts") {
          return (
            <div className="px-3 pt-2 pb-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 h-9"
                onClick={handleAddPrompt}
              >
                <Plus className="size-4" />
                Add Prompt
              </Button>
            </div>
          )
        }
        break
      case "Settings":
        return null
      default:
        return null
    }
    return null
  }

  const renderContent = () => {
    switch (activeItem.title) {
      case "Conversations":
        return (
          <div className="space-y-1 p-2">
            {conversations.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-4">
                No conversations yet
              </div>
            ) : (
              conversations.map((conversation) => {
                // Get participant summaries from the map
                const participants = conversationParticipantsMap.get(conversation.id) || []
                const avatars: (string | AvatarData)[] = []
                
                console.log('[Conversation Avatar] conversation:', conversation.id, 'participants:', participants)
                
                participants.forEach((participant: ParticipantSummary) => {
                  console.log('[Conversation Avatar] processing participant:', {
                    type: participant.participant_type,
                    id: participant.participant_id,
                    name: participant.display_name,
                    avatar_type: participant.avatar_type,
                    avatar_bg: participant.avatar_bg,
                    avatar_text: participant.avatar_text,
                  })
                  
                  console.log('[Conversation Avatar] participant_type check:', {
                    value: participant.participant_type,
                    typeof: typeof participant.participant_type,
                    isAssistant: participant.participant_type === 'assistant',
                    isModel: participant.participant_type === 'model',
                    isUser: participant.participant_type === 'user',
                  })
                  
                  // Handle different participant types with their specific avatar logic
                  if (participant.participant_type === 'assistant') {
                    console.log('[Conversation Avatar] ✅ Handling as ASSISTANT')
                    // For assistants, use the logic from chat-input.tsx
                    const hasCustomImage = participant.avatar_type === 'image' && 
                                          (participant.avatar_image_url || participant.avatar_image_path)
                    
                    if (hasCustomImage) {
                      // Image avatar for assistant
                      avatars.push({
                        type: 'image',
                        imageUrl: participant.avatar_image_url || participant.avatar_image_path || '',
                        fallback: participant.avatar_text || participant.display_name.charAt(0).toUpperCase()
                      })
                    } else {
                      // Text/emoji avatar for assistant (with background color)
                      const avatarBg = participant.avatar_bg || '#3b82f6'
                      avatars.push({
                        type: 'text',
                        text: participant.avatar_text || participant.display_name.charAt(0).toUpperCase(),
                        backgroundColor: avatarBg,
                        fallback: participant.avatar_text || participant.display_name.charAt(0).toUpperCase()
                      })
                    }
                  } else if (participant.participant_type === 'model' && participant.participant_id) {
                    console.log('[Conversation Avatar] ✅ Handling as MODEL')
                    // For models, get the model logo using getModelLogo
                    const model = getModelById(participant.participant_id)
                    if (model) {
                      const modelLogo = getModelLogo(model)
                      if (modelLogo) {
                        console.log('[Conversation Avatar] Using model logo:', modelLogo)
                        avatars.push({
                          type: 'image',
                          imageUrl: modelLogo,
                          fallback: participant.display_name.charAt(0).toUpperCase()
                        })
                      } else {
                        // Fallback to text avatar if no logo
                        avatars.push({
                          type: 'text',
                          text: participant.display_name.charAt(0).toUpperCase(),
                          backgroundColor: '#6366f1',
                          fallback: participant.display_name.charAt(0).toUpperCase()
                        })
                      }
                    }
                  } else if (participant.participant_type === 'user') {
                    console.log('[Conversation Avatar] ✅ Handling as USER')
                    // For users, use their avatar data
                    if (participant.avatar_type === 'image') {
                      const imageUrl = participant.avatar_image_url || participant.avatar_image_path
                      if (imageUrl) {
                        avatars.push({
                          type: 'image',
                          imageUrl,
                          fallback: participant.display_name.charAt(0).toUpperCase()
                        })
                      }
                    } else {
                      // Text/emoji avatar for user
                      avatars.push({
                        type: 'text',
                        text: participant.avatar_text || participant.display_name.charAt(0).toUpperCase(),
                        backgroundColor: participant.avatar_bg || '#6366f1',
                        fallback: participant.display_name.charAt(0).toUpperCase()
                      })
                    }
                  } else {
                    console.warn('[Conversation Avatar] ⚠️  Unknown participant type:', participant.participant_type)
                  }
                })
                
                console.log('[Conversation Avatar] final avatars:', avatars)
                
                // Fallback to placeholder avatar if no avatars found (loading state)
                const displayAvatars = avatars.length > 0 ? avatars : [{
                  type: 'text' as const,
                  text: '',
                  fallback: '',
                  isPlaceholder: true  // Use Tailwind's bg-muted class
                }]
                
                console.log('[Conversation Avatar] displayAvatars for', conversation.title, ':', displayAvatars)
                
                // Get last message from backend (with truncation for display)
                const lastMessage = conversation.last_message 
                  ? (conversation.last_message.length > 50 
                      ? conversation.last_message.substring(0, 50) + '...'
                      : conversation.last_message)
                  : 'No messages yet'
                
                return (
                  <MessageListItem
                    key={conversation.id}
                    avatars={displayAvatars}
                    summary={conversation.title}
                    timestamp={formatTimestamp(conversation.updated_at)}
                    lastMessage={lastMessage}
                    isActive={currentConversation?.id === conversation.id}
                    onClick={() => handleConversationClick(conversation.id)}
                  />
                )
              })
            )}
          </div>
        )
      case "Contacts":
        return (
          <>
            <Tabs key="contacts-tabs" value={activeContactsTab} onValueChange={setActiveContactsTab} className="w-full p-2">
              <TabsList className="w-full grid grid-cols-3 h-9">
                <TabsTrigger value="models" className="text-xs gap-1 px-2">
                  <Bot className="size-3.5" />Models
                </TabsTrigger>
                <TabsTrigger value="assistants" className="text-xs gap-1 px-2">
                  <Drama className="size-3.5" />Assistants
                </TabsTrigger>
                <TabsTrigger value="people" className="text-xs gap-1 px-2">
                  <Users className="size-3.5" />People
                </TabsTrigger>
              </TabsList>
              <TabsContent value="models" className="mt-2">
                <ModelList
                  vendors={vendorsList}
                  selectedModelId={selectedModel?.id || selectedAssistant?.model_id}
                  onModelClick={handleModelClick}
                  onModelSettings={handleModelSettings}
                  onModelStarToggle={handleModelStarToggle}
                  onVendorSettings={handleVendorSettings}
                />
              </TabsContent>
              <TabsContent value="assistants" className="mt-2">
                <AssistantList
                  groups={assistantGroups}
                  selectedAssistantId={selectedAssistant?.id}
                  onAssistantClick={handleAssistantClick}
                  onAssistantSettings={handleAssistantSettings}
                  onAssistantStarToggle={handleAssistantStarToggle}
                  onGroupSettings={handleGroupSettings}
                />
              </TabsContent>
              <TabsContent value="people" className="mt-2">
                <PeopleList
                  groups={peopleGroups}
                  selectedPersonId={selectedPersonId || undefined}
                  onPersonClick={handlePersonClick}
                  onPersonSettings={handlePersonSettings}
                  onPersonStarToggle={handlePersonStarToggle}
                  onGroupSettings={handlePersonGroupSettings}
                />
              </TabsContent>
            </Tabs>
          </>
        )
      case "Library":
        return (
          <Tabs key="library-tabs" value={activeLibraryTab} onValueChange={setActiveLibraryTab} className="w-full p-2">
            <TabsList className="w-full grid grid-cols-3 h-9">
              <TabsTrigger value="prompts" className="text-xs gap-1 px-2">
                <Sparkles className="size-3.5" />
                Prompts
              </TabsTrigger>
              <TabsTrigger value="knowledge" className="text-xs gap-1 px-2">
                <BookOpen className="size-3.5" />
                Knowledge
              </TabsTrigger>
              <TabsTrigger value="tools" className="text-xs gap-1 px-2">
                <Plug className="size-3.5" />
                Tools
              </TabsTrigger>
            </TabsList>
            <TabsContent value="prompts" className="mt-2">
              <PromptList
                groups={promptGroups}
                selectedPromptId={selectedPromptId || undefined}
                onPromptClick={handlePromptClick}
                onPromptSettings={handlePromptSettings}
                onPromptStarToggle={handlePromptStarToggle}
                onGroupSettings={handlePromptGroupSettings}
              />
            </TabsContent>
            <TabsContent value="knowledge" className="mt-2">
              {data.files.map((file) => (
                <a
                  href="#"
                  key={file.id}
                  className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-col items-start gap-2 border-b p-4 text-sm leading-tight last:border-b-0"
                >
                  <div className="flex w-full items-center gap-2">
                    <File className="size-4 text-muted-foreground" />
                    <span className="font-medium">{file.name}</span>
                  </div>
                  <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
                    <span>{file.type}</span>
                    <span>•</span>
                    <span>{file.size}</span>
                    <span className="ml-auto">{file.lastModified}</span>
                  </div>
                </a>
              ))}
            </TabsContent>
            <TabsContent value="tools" className="mt-2">
              {data.tools.map((tool) => (
                <a
                  href="#"
                  key={tool.id}
                  className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-col items-start gap-2 border-b p-4 text-sm leading-tight last:border-b-0"
                >
                  <div className="flex w-full items-center gap-2">
                    <Plug className="size-4 text-muted-foreground" />
                    <span className="font-medium">{tool.name}</span>
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded ${
                      tool.status === "connected" 
                        ? "bg-green-500/10 text-green-500" 
                        : "bg-red-500/10 text-red-500"
                    }`}>
                      {tool.status}
                    </span>
                  </div>
                  <span className="text-muted-foreground text-xs line-clamp-2">
                    {tool.description}
                  </span>
                  <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
                    <span>Last sync: {tool.lastSync}</span>
                  </div>
                </a>
              ))}
            </TabsContent>
          </Tabs>
        )
      case "Settings":
        return (
          <div className="p-4">
            <p className="text-sm text-muted-foreground">Settings panel coming soon...</p>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <Sidebar
      collapsible="icon"
      className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
      {...props}
    >
      {/* This is the first sidebar */}
      {/* We disable collapsible and adjust width to icon. */}
      {/* This will make the sidebar appear as icons. */}
      <Sidebar
        collapsible="none"
        className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r"
      >
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild className="md:h-8 md:p-0">
                <a href="#">
                  <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                    <Command className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Acme Inc</span>
                    <span className="truncate text-xs">Enterprise</span>
                  </div>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="px-1.5 md:px-0">
              <SidebarMenu>
                {data.navMain.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={{
                        children: item.title,
                        hidden: false,
                      }}
                      onClick={() => {
                        if (item.title === "Settings") {
                          setSettingsDialogOpen(true)
                        } else {
                          setActiveItem(item)
                          setOpen(true)
                        }
                      }}
                      isActive={activeItem?.title === item.title}
                      className="px-2.5 md:px-2"
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <NavUser user={data.user} />
        </SidebarFooter>
      </Sidebar>

      {/* This is the second sidebar */}
      {/* We disable collapsible and let it fill remaining space */}
      <Sidebar collapsible="none" className="hidden flex-1 md:flex">
        <SidebarHeader className="gap-3.5 border-b p-4">
          <div className="flex w-full items-center justify-between">
            <div className="text-foreground text-base font-medium">
              {activeItem?.title}
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="px-0">
            <SidebarGroupContent>
              {renderContent()}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t">
          {renderFooter()}
        </SidebarFooter>
      </Sidebar>
      
      <ProviderSettingsDialog
        open={providerDialogOpen}
        onOpenChange={setProviderDialogOpen}
      />
      
      <SettingsDialog
        open={settingsDialogOpen}
        onOpenChange={setSettingsDialogOpen}
      />
    </Sidebar>
  )
}
