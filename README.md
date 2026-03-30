# ChatShell

A lightweight desktop AI agent with 9 built-in tools. Built with Tauri 2 + Rust, not Electron.

**Agent-ready, out of the box** — no plugins, no MCP servers, no config files.

[![Download](https://img.shields.io/github/v/release/chatshellapp/chatshell-desktop?label=Download&color=brightgreen)](https://github.com/chatshellapp/chatshell-desktop/releases/latest)
[![Binary Size](https://img.shields.io/badge/Binary_Size-22MB-green)](https://github.com/chatshellapp/chatshell-desktop/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/chatshellapp/chatshell-desktop)](https://github.com/chatshellapp/chatshell-desktop/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](LICENSE)

> Web Search · Web Fetch · Bash · File Read/Edit/Write · Grep · Glob — all built in, zero config.
> No plugins to install, no MCP servers to set up. A working AI agent in under a minute.

[Download](https://github.com/chatshellapp/chatshell-desktop/releases/latest) · [Documentation](https://chatshell.app/docs) · [GitHub](https://github.com/chatshellapp/chatshell-desktop) · [Issues](https://github.com/chatshellapp/chatshell-desktop/issues)

---

## Quick Start

1. **[Download ChatShell](https://github.com/chatshellapp/chatshell-desktop/releases/latest)** — macOS (universal), Windows, Linux (22MB)
2. **Add an API key** — OpenAI, Anthropic, Google Gemini, or any of [40+ providers](https://chatshell.app/docs/providers)
3. **Try it:**

```
Search the web for the latest Rust release and summarize the changelog
```

ChatShell's AI will autonomously search the web, fetch the release page, and return a summary — no setup, no plugins.

Want to go further? Try:

```
Find all TODO comments in ~/projects/my-app, then create a markdown report on my desktop
```

The agent chains Grep, Read, and Write tools together to complete multi-step tasks on its own.

---

## What Can You Do

### Research & Summarize

- `Search for the best ergonomic keyboards in 2026 and compare the top 3`
- `Fetch https://blog.rust-lang.org and summarize the latest post`
- `Search for recent papers on RAG and write a summary to ~/Desktop/rag-notes.md`

### Code & Files

- `Find all files larger than 1MB in this project`
- `Read src/App.tsx and suggest performance improvements`
- `Replace all console.log calls with logger.info across this project`

### System & Automation

- `List all running Docker containers and show their resource usage`
- `Find which process is using port 3000 and kill it`
- `Create a bash script that backs up my project to ~/backups with a timestamp`

### Create & Generate

- `Generate a pixel art coffee shop with a cat sleeping on the counter` (Gemini Nana Banana 2)
- `Design a minimal app icon for a note-taking app, blue and white`
- `Create a diagram showing how microservices communicate` (Mermaid)

### Extend with Skills & MCP

- `Open my GitHub PRs and summarize what needs review` (agent-browser skill)
- Connect external tools via MCP servers — databases, APIs, dev tools — and the AI uses them seamlessly alongside built-in tools

---

## Screenshots

![ChatShell — Travel Planning with Web Search](docs/travel.png)

<details>
<summary>More screenshots</summary>

![ChatShell — Movie Research with Web Search & Fetch](docs/movies.png)

![ChatShell — Project Structure Analysis with Local Tools](docs/project.png)

</details>

---

## Why ChatShell?

### Agent-Ready, Out of the Box

Most AI clients are just chat wrappers — you type, the AI replies, end of story. ChatShell ships with **9 built-in tools** (Web Search, Web Fetch, Bash, Read, Edit, Write, Grep, Glob, Kill Shell) that your AI can use autonomously. Ask it to research a topic, summarize a web page, find a file on your disk, edit code, or run a command — it just works. No MCP servers to set up, no plugins to install, no config files to edit.

With ChatShell, you get a working AI agent in under a minute.

### Powerful Skills System

Go beyond simple prompts. **Skills** bundle prompt instructions with required tools into reusable, composable capabilities. Create your own by dropping a `SKILL.md` file into `~/.chatshell/skills/<skill-name>/`, or **paste a GitHub URL into the chat** — ChatShell downloads and installs it automatically. Each skill declares which tools it needs — those tools are enabled automatically when the skill is active. You control whether the AI triggers a skill on its own or waits for you to invoke it.

Skills use **progressive disclosure**: only the skills the AI decides to invoke are injected into the context window. Unused skills consume zero tokens, keeping your context budget lean no matter how many skills you have installed.

### Custom Assistants, Built Locally

Create personalized AI assistants entirely on your machine. Each assistant packages together a model, system prompt, user prompt, tools, skills, and a custom avatar — forming a complete AI persona you can switch between instantly. Organize them into groups, star your favorites, and reuse prompts from your library. No cloud account needed, no sharing of your data.

### Lightweight by Design

Built on **Tauri 2 with a Rust backend** — not Electron. ChatShell uses significantly less memory and disk space while delivering native-level performance on all three platforms (macOS, Windows, Linux).

### True Privacy

API keys encrypted with **AES-256-GCM** (master key stored in your OS keychain via Apple Keychain, Windows Credential Manager, or Secret Service). All data in local SQLite. No telemetry. No cloud dependency with local models.

### Permissive Open Source

**Apache 2.0** — use it commercially, fork it, embed it. No GPL restrictions, no per-seat pricing, no subscriptions.

---

## What Sets ChatShell Apart

Most AI desktop clients are chat wrappers. ChatShell is built differently — from the engine up.

| Feature | ChatShell | Typical Chat Client |
|---------|-----------|---------------------|
| Engine | Tauri 2 + Rust (not Electron) | Electron or native per platform |
| Agent Tools | 9 built-in tools, zero setup | Plugin marketplace or MCP config required |
| Skills System | Progressive disclosure — install from URL or create your own | Not available |
| MCP Support | On-demand tool loading · STDIO + HTTP + OAuth 2.1 / PKCE | STDIO or HTTP (no auth) |
| Chat History Search | Full-text search across all conversations | Not available or basic filter |
| Conversation Forking | Branch from any AI reply into a new thread | Not available |
| Rich Content | KaTeX math · Mermaid diagrams · syntax highlighting | Basic markdown only |
| Model Awareness | Auto-detects vision, tool use, image generation per model | Manual configuration |
| Multilingual UI | English, Chinese, and more planned | English only |
| Privacy | AES-256-GCM · OS keychain · no telemetry | Varies — often opt-out telemetry |
| Assistants | Full local builder with avatars & prompt library | Basic system prompt only |
| Memory Footprint | Low — native Rust binary | High (Electron ships a full browser) |
| License | Apache 2.0 — permissive open source | GPL, proprietary, or subscription |
| Platforms | macOS · Windows · Linux | Often macOS-only or partial support |
| AI Providers | 40+ with local model support | Varies |

*"Typical chat client" reflects common patterns across the category, not any specific product.*

---

## Features

### Agent-Ready Built-in Tools

Your AI can use these tools autonomously — no user intervention needed:

- **Web Search**: Multi-engine web search (DuckDuckGo, Baidu, Yahoo) with stealth mode
- **Web Fetch**: Intelligent content extraction from URLs (Readability + headless Chrome, or Jina Reader API)
- **Bash**: Execute shell commands in a per-conversation working directory
- **Read**: Read file contents from the local filesystem (text, images, PDFs)
- **Edit**: Make precise text replacements in files
- **Write**: Create or overwrite files with provided content
- **Grep**: Search file contents with regex support
- **Glob**: Find files by pattern matching
- **Kill Shell**: Terminate the current bash session and start fresh

The AI decides when and how to combine these tools to fulfill your requests.

### Skills

- **Prompt + Tools**: Bundle instructions with required tools for specialized capabilities
- **Progressive Disclosure**: Only invoked skills are injected into context — unused skills consume no tokens
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
- **Model Capability Awareness**: ChatShell knows each model's capabilities — vision, tool use, image generation — and adapts the UI automatically (e.g., disables image paste for text-only models)
- **Image Generation**: Generate images directly in chat with supported models (e.g., Gemini)
- **Manual Model Entry**: Add any model manually when auto-discovery doesn't find it
- **API Connectivity Check**: Test your provider connection right from the settings page
- **Configurable Parameters**: Temperature, max tokens, top-p, frequency/presence penalty, and more
- **Parameter Presets**: Save and reuse model configurations across conversations

### MCP (Model Context Protocol) Integration

- **Extensible Tool System**: Connect AI with external tools and data sources
- **Progressive Disclosure**: Only MCP tools the AI actually calls are loaded into context — unused tools consume no tokens
- **Server Management**: Add, configure, and manage MCP servers from the UI
- **JSON Config Import**: Paste `mcpServers` JSON from Claude Desktop, Cursor, or other tools to import servers instantly
- **Dynamic Tool Discovery**: Automatically detect and expose tools from MCP servers
- **Seamless Integration**: AI can invoke MCP tools naturally during conversations
- **Dual Transport**: STDIO (local child processes) and Streamable HTTP (remote servers)
- **Enterprise-Grade Auth**: None, Bearer token, or OAuth 2.0/2.1 (with PKCE) for HTTP servers
- **Per-Conversation Selection**: Enable different MCP servers for different conversations

### Rich Conversations

- **Streaming Responses**: See AI output as it generates in real time
- **Thinking Display**: View the model's reasoning process (for supported models)
- **Fork Conversations**: Branch off from any AI reply into a new conversation, keeping full context up to that point
- **Resend Messages**: Retry any user message with one click
- **Message Queue**: Keep typing while the AI is responding — your messages are queued and sent in order
- **Auto Title Generation**: Smart conversation titling
- **Context Window Control**: Configurable message context (5, 10, 20, 50, 100, or unlimited)
- **Working Directory**: Per-conversation working directory for file system tools
- **Persistent History**: All conversations stored locally in SQLite

### Chat History Search

- **Full-Text Search**: Find any message across all conversations instantly
- **Highlighted Snippets**: See matching text highlighted in search results
- **Jump to Message**: Click a result to go directly to that conversation and message

### Rich Content Rendering

- **Math Formulas**: Render LaTeX equations inline and in blocks with KaTeX
- **Diagrams**: Render Mermaid flowcharts, sequence diagrams, and more directly in chat
- **Syntax Highlighting**: Code blocks with language-aware highlighting and one-click copy

### Powerful Attachments

- **Drag & Drop**: Easily attach files to conversations
- **Clipboard Paste**: Paste images directly from clipboard
- **Smart File Detection**: Automatic type recognition with content deduplication (Blake3)
- **Documents**: Markdown, code files (JS, TS, Python, Rust, Go, Java, C/C++, etc.), JSON, YAML, TOML, XML, SQL, shell scripts, and plain text
- **Images**: PNG, JPEG, GIF, WebP, BMP — with built-in lightbox viewer
- **Web Pages**: Paste URLs to automatically fetch and attach page content

### Web-Enabled Agents

- **Intelligent Search Decision**: AI autonomously determines when to search the web
- **Multi-Engine Support**: DuckDuckGo, Baidu, Yahoo
- **Smart Web Fetching**: Extract and summarize content from URLs
- **Dual Fetch Modes**: Local (Readability + headless Chrome) or API (Jina Reader)
- **Configurable Local Methods**: Auto, fetch-only, or headless-only

### Prompt Management

- **Prompt Library**: Store and organize reusable prompts
- **Categories**: Group prompts by use case
- **Starred Prompts**: Mark frequently used prompts for quick access
- **System & User Prompts**: Separate system-level templates from user-level prompts
- **Quick Select**: Rapidly apply prompts from within the chat input

### Export

- **Screenshot Export**: Export conversations as PNG images via html-to-image
- **Markdown Export**: Download any assistant message as a `.md` file with one click
- **Flexible Scope**: Export all messages, a single conversation, or an individual message
- **Theme-Aware**: Exports respect current light/dark mode setting

### Multilingual Interface

- **Multiple Languages**: Interface available in English and Chinese, with more languages planned
- **Automatic Detection**: UI language follows your system preference

### Privacy-First Design

- **Local SQLite Storage**: All data stays on your machine
- **Encrypted Secrets**: API keys and MCP tokens encrypted with AES-256-GCM in local SQLite
- **Keychain Integration**: Master encryption key stored in native OS credential storage (Apple Keychain, Windows Credential Manager, Secret Service)
- **No Cloud Dependency**: Works entirely offline with local models

---

## Development

### Prerequisites

- Node.js 20+
- pnpm
- Rust 1.85+

### Quick Start

```bash
pnpm install
pnpm tauri dev
```

The app will be available at `http://localhost:1420`

### Testing

```bash
pnpm test                    # Run frontend tests
pnpm test:watch              # Watch mode
cd src-tauri && cargo test   # Run backend tests
```

For detailed commands and coding guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

### Build

```bash
pnpm tauri build
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri 2](https://tauri.app/) |
| Frontend | React 19, TypeScript, Vite 6 |
| Styling | TailwindCSS 4, Radix UI, Lucide icons |
| State | Zustand + Immer |
| Markdown | react-markdown, remark-gfm, KaTeX, Mermaid |
| Backend | Rust (Edition 2024), Tokio |
| LLM | [rig-core](https://rig.rs/) |
| MCP | [rmcp](https://github.com/modelcontextprotocol/rust-sdk) (HTTP + STDIO transports) |
| Database | SQLite via sqlx |
| Security | AES-256-GCM, keyring, Blake3 |
| Web Scraping | Readability, headless Chrome, htmd |

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Ways to Contribute

- Submit issues for bugs or feature requests
- Create pull requests for code improvements
- Improve documentation
- Report security vulnerabilities

---

## Security

For security vulnerabilities, please report via [GitHub Security Advisory](https://github.com/chatshellapp/chatshell-desktop/security/advisories)

---

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.

---

## Acknowledgements

Built on the shoulders of giants:

- [Tauri](https://tauri.app/) — Build smaller, faster, and more secure desktop applications
- [Rig](https://rig.rs/) — Modular LLM application framework
- [rmcp](https://github.com/modelcontextprotocol/rust-sdk) — Model Context Protocol SDK for Rust
- [Radix UI](https://www.radix-ui.com/) — Unstyled, accessible UI components
- [shadcn/ui](https://ui.shadcn.com/) — Beautiful, customizable components built with Radix UI and TailwindCSS
- [React](https://react.dev/) — The library for web and native user interfaces
