import { AppSidebar } from "@/components/app-sidebar"
import { InputGroupDemo } from "@/components/input-group"
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
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemDescription,
} from "@/components/ui/item"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Bot, User } from "lucide-react"
import gptAvatar from "@/assets/models/gpt.png"
import claudeAvatar from "@/assets/models/claude.png"
import geminiAvatar from "@/assets/models/gemini.png"
import llamaAvatar from "@/assets/models/llama.png"

// Sample chat messages
const messages = [
  {
    id: "1",
    role: "user",
    content: "Hello! Can you help me understand how React hooks work?",
    timestamp: "10:30 AM",
  },
  {
    id: "2",
    role: "assistant",
    content:
      "Of course! React Hooks are functions that let you use state and other React features in functional components. The most commonly used hooks are useState and useEffect. Would you like me to explain a specific hook in detail?",
    timestamp: "10:30 AM",
  },
  {
    id: "3",
    role: "user",
    content: "Yes, please explain useState with an example.",
    timestamp: "10:31 AM",
  },
  {
    id: "4",
    role: "assistant",
    content:
      "Great! useState is a Hook that lets you add state to functional components. Here's a simple example:\n\nconst [count, setCount] = useState(0);\n\nIn this example:\n- 'count' is the current state value\n- 'setCount' is the function to update the state\n- '0' is the initial state value\n\nWhen you call setCount, React re-renders the component with the new value.",
    timestamp: "10:31 AM",
  },
  {
    id: "5",
    role: "user",
    content: "That makes sense! What about useEffect?",
    timestamp: "10:32 AM",
  },
  {
    id: "6",
    role: "assistant",
    content:
      "useEffect is a Hook that performs side effects in functional components. It runs after every render by default, but you can control when it runs using a dependency array.\n\nFor example:\nuseEffect(() => {\n  document.title = `Count: ${count}`;\n}, [count]);\n\nThis effect updates the document title whenever 'count' changes. The array [count] tells React to only run this effect when 'count' changes.",
    timestamp: "10:32 AM",
  },
]

export default function Page() {
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
        <div className="flex flex-1 flex-col gap-1 overflow-auto pb-32">
          {messages.map((message) => (
            <Item
              key={message.id}
              variant="default"
              size="default"
              className={`border-0 rounded-none ${
                message.role === "assistant" ? "bg-muted/30" : ""
              }`}
            >
              <ItemMedia variant="image">
                <Avatar className="h-8 w-8">
                  {message.role === "user" ? (
                    <>
                      <AvatarImage src="" />
                      <AvatarFallback className="bg-primary/10">
                        <User className="h-4 w-4" />
                      </AvatarFallback>
                    </>
                  ) : (
                    <>
                      <AvatarImage src={gptAvatar} />
                      <AvatarFallback className="bg-green-500/10">
                        <Bot className="h-4 w-4 text-green-600" />
                      </AvatarFallback>
                    </>
                  )}
                </Avatar>
              </ItemMedia>
              <ItemContent className="gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">
                    {message.role === "user" ? "You" : "GPT-4"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {message.timestamp}
                  </span>
                </div>
                <ItemDescription className="text-foreground whitespace-pre-wrap line-clamp-none max-w-none">
                  {message.content}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </div>
        <div className="bg-background border-t p-4 flex justify-center sticky bottom-0 z-10">
          <InputGroupDemo />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
