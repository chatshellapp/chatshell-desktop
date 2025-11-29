import { useState, useEffect } from "react"
import { Settings, ChevronDown } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSettingsStore } from "@/stores/settingsStore"
import { useModelStore } from "@/stores/modelStore"

export function SimpleSettingsDialog() {
  const [open, setOpen] = useState(false)
  const [openaiKey, setOpenaiKey] = useState("")
  const [openrouterKey, setOpenrouterKey] = useState("")
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434")
  const [summaryModelId, setSummaryModelId] = useState("")

  const saveSetting = useSettingsStore((state: any) => state.saveSetting)
  const getSetting = useSettingsStore((state: any) => state.getSetting)
  const models = useModelStore((state) => state.models)
  const loadModels = useModelStore((state) => state.loadModels)
  const getModelById = useModelStore((state) => state.getModelById)
  
  // Load models when dialog opens
  useEffect(() => {
    if (open) {
      loadModels()
    }
  }, [open, loadModels])

  const handleOpen = async () => {
    // Load current settings
    const openaiValue = await getSetting("openai_api_key")
    const openrouterValue = await getSetting("openrouter_api_key")
    const ollamaValue = await getSetting("ollama_base_url")
    const summaryModelValue = await getSetting("conversation_summary_model_id")

    if (openaiValue) setOpenaiKey(openaiValue)
    if (openrouterValue) setOpenrouterKey(openrouterValue)
    if (ollamaValue) setOllamaUrl(ollamaValue)
    if (summaryModelValue) setSummaryModelId(summaryModelValue)
    
    setOpen(true)
  }

  const handleSave = async () => {
    try {
      if (openaiKey) await saveSetting("openai_api_key", openaiKey)
      if (openrouterKey) await saveSetting("openrouter_api_key", openrouterKey)
      if (ollamaUrl) await saveSetting("ollama_base_url", ollamaUrl)
      if (summaryModelId) await saveSetting("conversation_summary_model_id", summaryModelId)
      
      setOpen(false)
    } catch (error) {
      console.error("Failed to save settings:", error)
    }
  }
  
  const selectedModel = summaryModelId ? getModelById(summaryModelId) : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleOpen}
          className="size-8"
        >
          <Settings className="size-4" />
          <span className="sr-only">Settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your API keys and LLM provider settings.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="openai-key">OpenAI API Key</Label>
            <Input
              id="openai-key"
              type="password"
              placeholder="sk-..."
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="openrouter-key">OpenRouter API Key</Label>
            <Input
              id="openrouter-key"
              type="password"
              placeholder="sk-or-..."
              value={openrouterKey}
              onChange={(e) => setOpenrouterKey(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ollama-url">Ollama Base URL</Label>
            <Input
              id="ollama-url"
              type="text"
              placeholder="http://localhost:11434"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Make sure Ollama is running locally and you have models installed (e.g., gemma3:12b, gpt-oss:20b, deepseek-r1:14b)
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="summary-model">Conversation Title Model</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span className="truncate">
                    {selectedModel ? selectedModel.name : "Use current conversation model"}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[450px] max-h-[300px] overflow-y-auto">
                <DropdownMenuItem onClick={() => setSummaryModelId("")}>
                  <span>Use current conversation model (default)</span>
                </DropdownMenuItem>
                {models.map((model) => (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => setSummaryModelId(model.id)}
                  >
                    <span className="truncate">{model.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground">
              Choose a model for generating conversation titles. Defaults to the current conversation model if not set.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

