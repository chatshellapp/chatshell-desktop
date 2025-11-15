import { useState } from "react"
import { Settings } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSettingsStore } from "@/stores/settingsStore"

export function SimpleSettingsDialog() {
  const [open, setOpen] = useState(false)
  const [openaiKey, setOpenaiKey] = useState("")
  const [openrouterKey, setOpenrouterKey] = useState("")
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434")

  const saveSetting = useSettingsStore((state: any) => state.saveSetting)
  const getSetting = useSettingsStore((state: any) => state.getSetting)

  const handleOpen = async () => {
    // Load current settings
    const openaiValue = await getSetting("openai_api_key")
    const openrouterValue = await getSetting("openrouter_api_key")
    const ollamaValue = await getSetting("ollama_base_url")

    if (openaiValue) setOpenaiKey(openaiValue)
    if (openrouterValue) setOpenrouterKey(openrouterValue)
    if (ollamaValue) setOllamaUrl(ollamaValue)
    
    setOpen(true)
  }

  const handleSave = async () => {
    try {
      if (openaiKey) await saveSetting("openai_api_key", openaiKey)
      if (openrouterKey) await saveSetting("openrouter_api_key", openrouterKey)
      if (ollamaUrl) await saveSetting("ollama_base_url", ollamaUrl)
      
      setOpen(false)
    } catch (error) {
      console.error("Failed to save settings:", error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleOpen}
          className="h-8 w-8"
        >
          <Settings className="h-4 w-4" />
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

