import { MessageSquare, Users, Library, Settings } from "lucide-react"
import type { ModelVendor } from "@/components/model-list"
import type { PromptGroup } from "@/components/prompt-list"

export const SIDEBAR_DATA = {
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
}

