# Feature Guide

[Back to the README](../README.md)

### Agent-Ready Built-in Tools

Your AI can combine these tools to complete tasks. Choose Ask, Auto, or Yolo mode to decide how much runs without your approval (see [Permissions and Sandbox](#permissions-and-sandbox)):

- **Web Search**: Multi-engine web search (DuckDuckGo, Bing, Baidu, Yahoo) with stealth mode
- **Web Fetch**: Intelligent content extraction from URLs using HTTP, optional Obscura, the system WebView, and headless Chrome, or the Jina Reader API
- **Bash**: Execute shell commands in the conversation's working directory, or in a private per-conversation scratch directory when none is set; long output is kept for later turns
- **Read**: Read file contents from the local filesystem (text, images, PDFs with optional page ranges and page images for scans, videos as metadata and frames, Office documents: docx/xlsx/pptx with sheet and cell-range selection for spreadsheets). When Web Fetch is enabled, Read also accepts a URL and returns its raw content, such as a JSON or CSV file
- **Edit**: Make precise text replacements in files
- **Write**: Create or overwrite files with provided content
- **Grep**: Search file contents with regex support
- **Glob**: Find files by pattern matching
- **Kill Shell**: Terminate the current bash session and start fresh

The AI decides when and how to combine these tools to fulfill your requests.

### Permissions and Sandbox

- **Three Modes**: Choose Ask, Auto, or Yolo per conversation from the input toolbar; new conversations start in the default mode set in Settings → Permissions (Auto on fresh installs, using Ask when the model can't review actions), and switching to Yolo always asks to confirm
- **Ask**: Shell commands run inside the OS sandbox and those that stay inside it run without asking; commands that need the network or write outside the allowed folders, file edits, and other tool calls wait for approval. Without a sandbox, shell commands are confirmed too
- **Auto**: The conversation's model reviews each action before it runs and approves the safe ones without prompting; a turn's tool calls are reviewed together. Reviews appear as cards with the outcome, risk, and rationale, and a blocked action can be run anyway. Models that cannot review fall back to Ask
- **Yolo**: Runs everything without asking and without the sandbox; a built-in blocklist still stops catastrophic operations
- **OS Sandbox**: macOS Seatbelt and Linux bubblewrap; Settings → Permissions shows this machine's sandbox status
- **Approval Controls**: Allow a tool call once, allow it for the session, or deny it; sandbox cards offer running once outside the sandbox or allowing network access for the session
- **Remembered Approvals**: Remember an approval on this device and review or clear remembered approvals in Settings; they never sync
- **Protected Data**: The assistant cannot read ChatShell's own data folder, asks before reading shell configuration files, and the sandbox blocks access to stored credentials
- **Bash Environment**: Commands get a minimal environment plus the variables you choose to pass through in Settings → Permissions
- **Queued Requests**: Concurrent approval requests are presented in order; switching modes clears session grants

### Skills

- **Prompt + Tools**: Bundle instructions with required tools for specialized capabilities
- **Progressive Disclosure**: Skill names and short descriptions appear in the discovery catalog; full instructions are loaded when a skill is invoked
- **Custom Skills**: Create your own skills (`~/.chatshell/skills/<skill-name>/SKILL.md`)
- **Install from URL**: Paste a GitHub, GitLab, or Bitbucket link into the chat to install skills automatically
- **Invocation Control**: Choose whether the AI or the user triggers each skill
- **Auto-Discovery**: Skill Scanner finds skills from multiple configured directories
- **Per-Conversation Selection**: Enable different skills for different conversations

### Custom Assistants

- **Full Configuration**: Each assistant combines a model, system/user prompts, tools, skills, and avatar into one reusable persona
- **Prompt Library Integration**: Select prompts from your library or write custom ones
- **Tool & Skill Assignment**: Pick which built-in tools, MCP servers, and skills each assistant can use
- **Groups & Favorites**: Organize assistants by category, star frequently used ones for quick access
- **Custom Avatars**: Personalize with emoji + color backgrounds

### 40+ AI Providers

- **Cloud**: OpenAI, Anthropic, Google Gemini, Azure OpenAI, OpenRouter, DeepSeek, Groq, Mistral, Perplexity, Together AI, xAI, Cohere, Moonshot, Hyperbolic, Galadriel, MiniMax, Mira, GitHub Models, Fireworks AI, NVIDIA NIM, Hugging Face, Cerebras, Alibaba Qwen, Zhipu AI, Doubao, SiliconFlow, and more
- **Local**: Ollama, LM Studio, GPUStack, OVMS — run LLMs entirely on your machine
- **Custom Endpoints**: Connect any OpenAI-compatible or Anthropic-compatible API
- **Smart Model Discovery**: Automatically fetch available models from 30+ providers
- **Model Capability Awareness**: ChatShell knows each model's capabilities — vision, tool use, image generation — and adapts the UI automatically, including image attachment availability based on vision support and fallback models
- **Image Generation**: Generate images directly in chat with supported models (e.g., Gemini)
- **Vision Fallback**: Attach images even when the conversation model is text-only by routing image questions to a configured vision-capable model
- **Auxiliary Models**: Choose separate models for titles and compaction summaries, and for answering image questions
- **Manual Model Entry**: Add any model manually when auto-discovery doesn't find it
- **API Connectivity Check**: Test your provider connection right from the settings page
- **Configurable Parameters**: Temperature, max tokens, top-p, frequency/presence penalty, and more
- **Parameter Presets**: Save and reuse model configurations across conversations

### MCP (Model Context Protocol) Integration

- **Extensible Tool System**: Connect AI with external tools and data sources
- **Progressive Disclosure**: The model can request MCP tool schemas before calling a tool; discovery and schema information still use context
- **Server Management**: Add, configure, and manage MCP servers from the UI
- **JSON Config Import**: Paste `mcpServers` JSON from Claude Desktop, Cursor, or other tools to import servers instantly
- **Dynamic Tool Discovery**: Automatically detect and expose tools from MCP servers
- **Seamless Integration**: AI can invoke MCP tools naturally during conversations
- **Dual Transport**: STDIO (local child processes) and Streamable HTTP (remote servers)
- **Enterprise-Grade Auth**: None, Bearer token, or OAuth 2.0/2.1 (with PKCE) for HTTP servers
- **Per-Conversation Selection**: Enable different MCP servers for different conversations

### Rich Conversations

- **Streaming Responses**: See AI output as it generates in real time
- **Generation Status**: Sidebar conversation rows show when a response is generating; a waiting indicator with elapsed time appears before the first output
- **Thinking Display**: View the model's reasoning process (for supported models)
- **Collapsible Runs**: Expand thinking, tool calls, and intermediate text together, with step counts and completion status; the final answer stays visible outside the group
- **Fork Conversations**: Branch off from any AI reply into a new conversation, keeping full context up to that point
- **Resend Messages**: Retry any user message with one click
- **Conversation Trees**: Resend messages or regenerate replies without losing earlier branches, and switch between alternate versions with the message navigation arrows
- **Failure Recovery**: Retry failed or stopped turns, inspect errors, and return to the previous reply when available; partial replies remain visible with their run status
- **Message Queue**: Keep typing while the AI is responding — your messages are queued and sent in order
- **Auto Title Generation**: Smart conversation titling
- **Context Window Control**: Configurable message context (5, 10, 20, 50, 100, or unlimited)
- **Automatic Context Compaction**: Compact older context as long conversations approach the model's context window
- **Working Directory**: Per-conversation working directory for file system tools; the assistant saves deliverables there and keeps scratch files in a temporary folder
- **@-Mentions**: Type @ in the message box to pick a file from the working directory and attach it
- **File Changes and Undo**: Each reply lists the files it created or modified; undo a turn's file changes to restore them (changes made by shell commands are not tracked)
- **Persistent History**: All conversations stored locally in SQLite

### Encrypted iCloud Sync

- **Optional Cross-Device Sync**: Sync conversation history and attachments through iCloud Drive on supported macOS and iOS builds
- **Encrypted Transport**: Snapshots and attachments are encrypted before upload; save the sync passphrase to unlock history on new devices
- **Manual Controls**: Sync now, force publish this device's state, stop publishing, or delete cloud data from Settings
- **Availability**: Requires iCloud Drive; see [sync development requirements](../CONTRIBUTING.md#testing-icloud-sync) when building from source

### Translator

- **Full-Page Translation**: Translate with source and result side by side
- **Language Detection**: On-device detection picks the target language from your primary and secondary languages, which default to your system languages
- **Keyboard Shortcuts**: Translate and copy results without leaving the keyboard
- **Translation History**: Search, restore, and remove past translations; history stays on this device and can be turned off
- **Continue in Conversation**: Move a translation into a conversation for follow-up questions

### Chat History Search

- **Full-Text Search**: Search message text across conversations
- **Highlighted Snippets**: See matching text highlighted in search results
- **Jump to Message**: Click a result to go directly to that conversation and message

### Rich Content Rendering

- **Math Formulas**: Render LaTeX equations inline and in blocks with KaTeX
- **Diagrams**: Render Mermaid flowcharts, sequence diagrams, and more directly in chat
- **Charts and KPI Cards**: Bar, line, area, pie, radar, and radial charts and KPI cards drawn from the model's output
- **SVG Figures**: Inline figures with animation controls, zoom, source view, copy, and save
- **Shared Palette**: Charts, figures, and diagrams use one color palette that follows light and dark mode
- **Syntax Highlighting**: Code blocks with language-aware highlighting and one-click copy

### Powerful Attachments

- **Drag & Drop**: Easily attach files to conversations
- **Clipboard Paste**: Paste images directly from clipboard
- **Smart File Detection**: Automatic type recognition with content deduplication (Blake3)
- **Documents**: Markdown, code files (JS, TS, Python, Rust, Go, Java, C/C++, etc.), JSON, YAML, TOML, XML, SQL, shell scripts, and plain text; long files send their beginning and the AI reads the rest on demand
- **PDFs**: The original file is kept alongside its extracted text; scanned PDFs attach too, and the AI can read their pages as images
- **Data Files**: CSV and TSV, previewed by their header and first rows; with Bash enabled the AI works on a copy with shell tools
- **Office Documents**: docx/xlsx/pptx (and macro-enabled variants) travel as binary attachments the AI reads with the Read tool; previews show the extracted text
- **Images**: PNG, JPEG, GIF, WebP, BMP — resized to fit provider limits when attached, with built-in lightbox viewer
- **Videos**: MP4, MOV, M4V, WebM, MKV, and AVI up to 100 MB; the AI reads metadata and frames with the Read tool when ffmpeg is installed
- **Folders**: Attach a one-level folder listing from + → Folder
- **Size Limits**: Oversized files are rejected with the reason and what to do instead
- **Web Pages**: Paste URLs to automatically fetch and attach page content

### Web-Enabled Agents

- **Intelligent Search Decision**: AI autonomously determines when to search the web
- **Multi-Engine Support**: DuckDuckGo, Bing, Baidu, Yahoo
- **Smart Web Fetching**: Extract and summarize content from URLs
- **Dual Fetch Modes**: Local content extraction with browser fallbacks, or API (Jina Reader)
- **Tiered Fetching**: Auto mode falls back from HTTP to optional Obscura, the system WebView, and then headless Chrome
- **Configurable Local Methods**: Auto, fetch-only, Obscura (when installed), system WebView, or Chrome
- **Optional Obscura**: Settings shows an installation link when the browser is unavailable

### Prompt Management

- **Prompt Library**: Store and organize reusable prompts
- **Categories**: Group prompts by use case
- **Starred Prompts**: Mark frequently used prompts for quick access
- **System & User Prompts**: Separate system-level templates from user-level prompts
- **Quick Select**: Rapidly apply prompts from within the chat input
- **Sent Prompt History**: Press ArrowUp in an empty input to recall sent prompts across conversations; use ArrowUp/ArrowDown to browse them

### Export

- **Screenshot Export**: Export conversations as PNG images via html-to-image
- **Markdown Export**: Download any assistant message as a `.md` file with one click
- **Flexible Scope**: Export all messages, a single conversation, or an individual message
- **Theme-Aware**: Exports respect current light/dark mode setting

### Auto-Update

- **In-App Updates**: Check, download, and install updates from Settings → About — no manual downloads
- **Signature-Verified**: Every update package is minisign-verified against a public key baked into the app; verification cannot be disabled
- **First-Party Feed**: Update checks hit `dl.chatshell.app` first (GitHub Releases as fallback); no usage data is sent
- **You Stay in Control**: Nothing installs without an explicit click; automatic checking can be turned off, and a version can be skipped until a newer one ships

### Multilingual Interface

- **Multiple Languages**: Interface available in English and Chinese, with more languages planned
- **Automatic Detection**: UI language follows your system preference

### Privacy-First Design

- **Local SQLite Storage**: Conversations are stored locally; optional iCloud sync uploads encrypted copies, and cloud models receive the content sent to them
- **Encrypted Secrets**: API keys and MCP tokens encrypted with AES-256-GCM in local SQLite
- **Keychain Integration**: Master encryption key stored in native OS credential storage (Apple Keychain, Windows Credential Manager, Secret Service)
- **No Cloud Dependency**: Local models can handle local tasks offline once installed. Web search, web fetching, remote integrations, downloads, and cloud sync require connectivity

### Diagnostics

- **Log Storage Controls**: View log storage usage, open the log directory, and set a storage size limit
- **AI Log Diagnosis**: Start a conversation with a prompt to inspect recent logs and suggest fixes

