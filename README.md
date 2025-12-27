# ChatShell

**Your AI, in a Shell. Stand Alone, Yet Connected.**

[![GitHub stars](https://img.shields.io/github/stars/chatshellapp/chatshell-desktop)](https://github.com/chatshellapp/chatshell-desktop/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-2024-orange)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-blue)](https://react.dev/)

ChatShell is an open-source desktop AI client built with Tauri 2 and React 19. Chat with any model, grant them web access, watch them think, and create groups — all in a native, privacy-first app.

[Website](https://chatshell.app/) | [GitHub](https://github.com/chatshellapp/chatshell-desktop) | [Issues](https://github.com/chatshellapp/chatshell-desktop/issues)

---

## Screenshot

![ChatShell Interface](docs/screenshot.png)

---

## Features

### 🤖 Multi-Model Support

- **Cloud Providers**: OpenAI, OpenRouter
- **Local Models**: Ollama (run LLMs entirely on your machine)
- **Smart Model Discovery**: Automatically fetch available models from providers
- **Configurable Parameters**: Temperature, context length, and more

### 💬 Rich Conversations

- **Streaming Responses**: See AI thoughts as they generate
- **Thinking Display**: View reasoning process (for supported models)
- **Auto Title Generation**: Smart conversation titling
- **Message History**: Persistent local storage

### 📎 Powerful Attachments

- **Drag & Drop**: Easily attach files to conversations
- **Clipboard Paste**: Paste images directly from clipboard
- **Smart File Detection**: Automatic type recognition
- **Multi-Format Support**: Markdown, code files, JSON, text, images

### 🌐 Web-Enabled Agents

- **Intelligent Search Decision**: AI autonomously determines when to search the web
- **Multi-Engine Support**: DuckDuckGo, Baidu, Yahoo
- **Smart Web Fetching**: Extract and summarize content from URLs
- **Jina API Integration**: High-quality content extraction

### 🎨 Custom Assistants

- Create personalized AI assistants with custom system prompts
- **Parameter Presets**: Save and reuse model configurations
- **Assistant Groups**: Organize assistants by category
- **Starred Favorites**: Quick access to frequently used assistants
- **Custom Avatars**: Personalize with text or image avatars

### 📝 Prompt Management

- **Prompt Library**: Store and organize reusable prompts
- **Categories**: Group prompts by use case (Development, Documentation, Testing, etc.)
- **Starred Prompts**: Mark frequently used prompts for quick access
- **System Prompts**: Mark prompts as system-level templates
- **Full CRUD**: Create, edit, delete, and organize your prompt collection

### 🔒 Privacy-First Design

- **Local SQLite Storage**: All data stays on your machine
- **Encrypted Secrets**: API keys stored securely with AES-256-GCM
- **Keychain Integration**: Native OS credential storage
- **No Cloud Dependency**: Works offline

---

## Installation

Download **signed binaries** from [chatshell.app](https://chatshell.app/) or build from source.

## Development

### Prerequisites

- Node.js 20+
- pnpm
- Rust 1.75+
- SQLite

### Quick Start

```bash
# Frontend setup
cd chatshell-desktop
pnpm install

# Start development server (frontend)
pnpm dev

# Start Tauri app (separate terminal)
cd src-tauri
cargo run
```

The app will be available at `http://localhost:1420`

For detailed commands and coding guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

### Build

```bash
# Frontend build
pnpm build

# Desktop app build
cd src-tauri
cargo build --release
```

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

- [Tauri](https://tauri.app/) - Build smaller, faster, and more secure desktop applications
- [Rig](https://rig.rs/) - Modular LLM application framework
- [Radix UI](https://www.radix-ui.com/) - Unstyled, accessible UI components
- [React](https://react.dev/) - The library for web and native user interfaces
