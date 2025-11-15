import { AppSidebar } from "@/components/app-sidebar"
import { ChatInput } from "@/components/chat-input"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { ChatMessage } from "@/components/chat-message"
import gptAvatar from "@/assets/models/gpt.png"
import { aiModels, assistantGroups } from "@/lib/data"

// Global chat message configuration
const CHAT_CONFIG = {
  userMessageAlign: "right" as const, // "left" | "right"
  userMessageShowBackground: true, // true | false
}

// Sample chat messages
const messages: Array<{
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: string
}> = [
  {
    id: "1",
    role: "user",
    content: "Hello! Can you help me understand how React hooks work?",
    timestamp: "05/01/2020 10:30",
  },
  {
    id: "2",
    role: "assistant",
    content:
      "Of course! React Hooks are functions that let you use state and other React features in functional components. The most commonly used hooks are useState and useEffect. Would you like me to explain a specific hook in detail?",
    timestamp: "05/01/2020 10:30",
  },
  {
    id: "3",
    role: "user",
    content: "Yes, please explain useState with an example.",
    timestamp: "05/01/2020 10:31",
  },
  {
    id: "4",
    role: "assistant",
    content:
      "Great! useState is a Hook that lets you add state to functional components. Here's a simple example:\n\nconst [count, setCount] = useState(0);\n\nIn this example:\n- 'count' is the current state value\n- 'setCount' is the function to update the state\n- '0' is the initial state value\n\nWhen you call setCount, React re-renders the component with the new value.",
    timestamp: "05/01/2020 10:31",
  },
  {
    id: "5",
    role: "user",
    content: "That makes sense! What about useEffect?",
    timestamp: "05/01/2020 10:32",
  },
  {
    id: "6",
    role: "assistant",
    content:
      "useEffect is a Hook that performs side effects in functional components. It runs after every render by default, but you can control when it runs using a dependency array.\n\nFor example:\nuseEffect(() => {\n  document.title = `Count: ${count}`;\n}, [count]);\n\nThis effect updates the document title whenever 'count' changes. The array [count] tells React to only run this effect when 'count' changes.",
    timestamp: "05/01/2020 10:32"
  },
]

export default function Page() {
  const handleCopy = () => {
    console.log("Message copied")
  }

  const handleResend = () => {
    console.log("Resend message")
  }

  const handleTranslate = () => {
    console.log("Translate message")
  }

  const handleExportAll = () => {
    console.log("Export all messages")
  }

  const handleExportConversation = () => {
    console.log("Export current conversation")
  }

  const handleExportMessage = () => {
    console.log("Export current message")
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "350px",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset className="flex flex-col relative">
        <header className="bg-background sticky top-0 flex shrink-0 items-center gap-2 border-b p-4 z-10">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="#">Conversations</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>React Hooks Discussion</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className="flex flex-1 flex-col overflow-auto pb-32">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              timestamp={message.timestamp}
              modelName="GPT-4.1 · OpenRouter"
              modelAvatar={gptAvatar}
              userMessageAlign={CHAT_CONFIG.userMessageAlign}
              userMessageShowBackground={CHAT_CONFIG.userMessageShowBackground}
              onCopy={handleCopy}
              onResend={handleResend}
              onTranslate={handleTranslate}
              onExportAll={handleExportAll}
              onExportConversation={handleExportConversation}
              onExportMessage={handleExportMessage}
            />
          ))}
        </div>
        <div className="bg-background border-t p-4 flex justify-center sticky bottom-0 z-10">
          <ChatInput 
            modelVendors={aiModels}
            assistantGroups={assistantGroups}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
