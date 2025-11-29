import { MessageSquare, Users, Library, Package, Settings } from "lucide-react"
import type { PromptGroup } from "@/components/prompt-list"
import type { NavItem } from "@/components/sidebar/sidebar-navigation"

export interface Artifact {
  id: string
  name: string
  type: "code" | "document" | "image" | "chart" | "component"
  language?: string
  preview?: string
  createdAt: string
  conversationId?: string
  isStarred: boolean
}

export interface ArtifactGroup {
  id: string
  name: string
  defaultOpen: boolean
  artifacts: Artifact[]
}

export const SIDEBAR_DATA: {
  user: { name: string; email: string; avatar: string }
  navMain: NavItem[]
  peopleGroups: Array<{
    id: string
    name: string
    defaultOpen: boolean
    people: Array<{
      id: string
      name: string
      email: string
      phone?: string
      bio: string
      isStarred: boolean
    }>
  }>
  promptGroups: PromptGroup[]
  files: Array<{ id: string; name: string; type: string; size: string; lastModified: string }>
  tools: Array<{ id: string; name: string; description: string; status: string; lastSync: string }>
  artifactGroups: ArtifactGroup[]
} = {
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
      title: "Artifacts",
      url: "#",
      icon: Package,
      isActive: false,
    },
    {
      title: "Settings",
      url: "#",
      icon: Settings,
      isActive: false,
    }
  ] as NavItem[],
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
  artifactGroups: [
    {
      id: "code",
      name: "Code Snippets",
      defaultOpen: true,
      artifacts: [
        {
          id: "artifact-1",
          name: "React Button Component",
          type: "code",
          language: "tsx",
          preview: "export const Button = ({ children, onClick }) => ...",
          createdAt: "Today",
          isStarred: true,
        },
        {
          id: "artifact-2",
          name: "API Fetch Utility",
          type: "code",
          language: "typescript",
          preview: "async function fetchData<T>(url: string): Promise<T> ...",
          createdAt: "Yesterday",
          isStarred: false,
        },
        {
          id: "artifact-3",
          name: "Database Schema",
          type: "code",
          language: "sql",
          preview: "CREATE TABLE users (id UUID PRIMARY KEY, ...)",
          createdAt: "2 days ago",
          isStarred: true,
        },
      ],
    },
    {
      id: "documents",
      name: "Documents",
      defaultOpen: false,
      artifacts: [
        {
          id: "artifact-4",
          name: "Project Architecture Overview",
          type: "document",
          preview: "# System Architecture\n\nThis document describes...",
          createdAt: "3 days ago",
          isStarred: false,
        },
        {
          id: "artifact-5",
          name: "API Documentation",
          type: "document",
          preview: "## Endpoints\n\n### GET /api/users...",
          createdAt: "1 week ago",
          isStarred: true,
        },
      ],
    },
    {
      id: "components",
      name: "UI Components",
      defaultOpen: false,
      artifacts: [
        {
          id: "artifact-6",
          name: "Dashboard Chart",
          type: "chart",
          preview: "Line chart showing monthly revenue trends",
          createdAt: "Today",
          isStarred: false,
        },
        {
          id: "artifact-7",
          name: "User Profile Card",
          type: "component",
          preview: "Interactive profile card with avatar and stats",
          createdAt: "Yesterday",
          isStarred: false,
        },
      ],
    },
  ],
}

