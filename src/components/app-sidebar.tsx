"use client"

import * as React from "react"
import { Bot, Command, Drama, File, Library, MessageSquare, Settings, Users, Sparkles, Database, Plug } from "lucide-react"

import { NavUser } from "@/components/nav-user"
import { MessageListItem } from "@/components/message-list-item"
import { ModelList, type Model, type ModelVendor } from "@/components/model-list"
import gptAvatar from "@/assets/models/gpt.png"
import claudeAvatar from "@/assets/models/claude.png"
import geminiAvatar from "@/assets/models/gemini.png"
import llamaAvatar from "@/assets/models/llama.png"
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
  prompts: [
    {
      id: "1",
      name: "Code Review Template",
      description: "Standard template for code review comments",
      category: "Development",
      lastUsed: "Today",
    },
    {
      id: "2",
      name: "Bug Report Format",
      description: "Template for reporting bugs with all necessary details",
      category: "Development",
      lastUsed: "Yesterday",
    },
    {
      id: "3",
      name: "API Documentation",
      description: "Generate comprehensive API documentation",
      category: "Documentation",
      lastUsed: "2 days ago",
    },
    {
      id: "4",
      name: "Unit Test Generator",
      description: "Create unit tests for functions",
      category: "Testing",
      lastUsed: "1 week ago",
    },
  ],
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
  mcpServers: [
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
  const [selectedConversation, setSelectedConversation] = React.useState<string | null>("1")
  const [selectedModelId, setSelectedModelId] = React.useState<string | null>("gpt-4-turbo")
  const [modelVendors, setModelVendors] = React.useState<ModelVendor[]>(data.aiModels)
  const { setOpen } = useSidebar()

  const handleModelClick = (model: Model) => {
    console.log("Model selected:", model)
    setSelectedModelId(model.id)
  }

  const handleModelSettings = (model: Model) => {
    console.log("Model settings:", model)
    // Add your model settings logic here
  }

  const handleModelStarToggle = (model: Model) => {
    console.log("Toggle star for model:", model)
    setModelVendors(prevVendors =>
      prevVendors.map(vendor => ({
        ...vendor,
        models: vendor.models.map(m =>
          m.id === model.id ? { ...m, isStarred: !m.isStarred } : m
        ),
      }))
    )
  }

  const handleVendorSettings = (vendor: ModelVendor) => {
    console.log("Vendor settings:", vendor)
    // Add your vendor settings logic here
  }

  const renderContent = () => {
    switch (activeItem.title) {
      case "Conversations":
        return (
          <div className="space-y-1 p-2">
            {data.conversations.map((conversation) => (
              <MessageListItem
                key={conversation.id}
                avatars={conversation.avatars}
                summary={conversation.name}
                timestamp={conversation.timestamp}
                lastMessage={conversation.lastMessage}
                isActive={selectedConversation === conversation.id}
                onClick={() => setSelectedConversation(conversation.id)}
              />
            ))}
          </div>
        )
      case "Contacts":
        return (
          <>
            <Tabs defaultValue="models" className="w-full p-2">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="models"><Bot className="size-4" />Models</TabsTrigger>
                <TabsTrigger value="assistants"><Drama className="size-4" />Assistants</TabsTrigger>
              </TabsList>
              <TabsContent value="models" className="mt-2">
                <ModelList
                  vendors={modelVendors}
                  selectedModelId={selectedModelId || undefined}
                  onModelClick={handleModelClick}
                  onModelSettings={handleModelSettings}
                  onModelStarToggle={handleModelStarToggle}
                  onVendorSettings={handleVendorSettings}
                />
              </TabsContent>
              <TabsContent value="assistants" className="space-y-1">
                {data.bots.map((bot) => (
                  <a
                    href="#"
                    key={bot.id}
                    className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-col items-start gap-2 rounded-lg p-3 text-sm leading-tight transition-colors"
                  >
                    <div className="flex w-full items-center gap-2">
                      <span className="font-medium">{bot.name}</span>
                    </div>
                    <span className="text-muted-foreground line-clamp-1">
                      {bot.description}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Model: {bot.model}
                    </span>
                  </a>
                ))}
              </TabsContent>
            </Tabs>
          </>
        )
      case "Library":
        return (
          <Tabs defaultValue="prompts" className="w-full">
            <TabsList className="w-full grid grid-cols-4 m-2">
              <TabsTrigger value="prompts" className="text-xs">
                <Sparkles className="size-3" />
                Prompts
              </TabsTrigger>
              <TabsTrigger value="files" className="text-xs">
                <File className="size-3" />
                Files
              </TabsTrigger>
              <TabsTrigger value="bases" className="text-xs">
                <Database className="size-3" />
                Bases
              </TabsTrigger>
              <TabsTrigger value="mcp" className="text-xs">
                <Plug className="size-3" />
                MCP
              </TabsTrigger>
            </TabsList>
            <TabsContent value="prompts" className="m-0">
              {data.prompts.map((prompt) => (
                <a
                  href="#"
                  key={prompt.id}
                  className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-col items-start gap-2 border-b p-4 text-sm leading-tight last:border-b-0"
                >
                  <div className="flex w-full items-center gap-2">
                    <Sparkles className="size-4 text-muted-foreground" />
                    <span className="font-medium">{prompt.name}</span>
                  </div>
                  <span className="text-muted-foreground text-xs line-clamp-2">
                    {prompt.description}
                  </span>
                  <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
                    <span className="bg-sidebar-accent px-2 py-0.5 rounded">{prompt.category}</span>
                    <span className="ml-auto">Used {prompt.lastUsed}</span>
                  </div>
                </a>
              ))}
            </TabsContent>
            <TabsContent value="files" className="m-0">
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
            <TabsContent value="bases" className="m-0">
              {data.knowledgeBases.map((base) => (
                <a
                  href="#"
                  key={base.id}
                  className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-col items-start gap-2 border-b p-4 text-sm leading-tight last:border-b-0"
                >
                  <div className="flex w-full items-center gap-2">
                    <Database className="size-4 text-muted-foreground" />
                    <span className="font-medium">{base.name}</span>
                  </div>
                  <span className="text-muted-foreground text-xs line-clamp-2">
                    {base.description}
                  </span>
                  <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
                    <span>{base.documents} documents</span>
                    <span className="ml-auto">Updated {base.lastUpdated}</span>
                  </div>
                </a>
              ))}
            </TabsContent>
            <TabsContent value="mcp" className="m-0">
              {data.mcpServers.map((server) => (
                <a
                  href="#"
                  key={server.id}
                  className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-col items-start gap-2 border-b p-4 text-sm leading-tight last:border-b-0"
                >
                  <div className="flex w-full items-center gap-2">
                    <Plug className="size-4 text-muted-foreground" />
                    <span className="font-medium">{server.name}</span>
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded ${
                      server.status === "connected" 
                        ? "bg-green-500/10 text-green-500" 
                        : "bg-red-500/10 text-red-500"
                    }`}>
                      {server.status}
                    </span>
                  </div>
                  <span className="text-muted-foreground text-xs line-clamp-2">
                    {server.description}
                  </span>
                  <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
                    <span>Last sync: {server.lastSync}</span>
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
                        setActiveItem(item)
                        setOpen(true)
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
      </Sidebar>
    </Sidebar>
  )
}
