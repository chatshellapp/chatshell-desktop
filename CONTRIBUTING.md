# Contributing to ChatShell

First off, thank you for considering contributing to ChatShell. It's people like you that make ChatShell such an amazing project.

## How to Contribute

There are several ways you can contribute:

1. **Fix Bugs**: Submit fixes for bugs you find
2. **Improve Performance**: Help optimize existing code
3. **Write Documentation**: Help improve user manuals and developer guides
4. **Report Bugs**: Help us identify issues in the project

## Getting Started

### Your First Code Contribution

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/chatshell-desktop.git
   ```
3. Create a new branch:
   ```bash
   git checkout -b fix/your-fix-name     # Bug fix
   git checkout -b perf/your-improvement # Performance improvement
   git checkout -b docs/your-update      # Documentation update
   git checkout -b refactor/your-change  # Refactor or minor enhancement
   ```
4. Make your changes
5. Commit your changes:
   ```bash
   git commit -m "Add your feature"
   ```
6. Push to the branch:
   ```bash
   git push origin fix/your-fix-name
   ```
7. Open a Pull Request

## Development Setup

For installation and quick start commands, see the [Development section in README.md](README.md#development).

### Commands

```bash
pnpm install              # Install dependencies
pnpm tauri dev            # Start development app
pnpm tauri build          # Build release bundle
```

## Tech Stack

ChatShell is built with a modern hybrid architecture:

| Layer               | Technology                                      |
| ------------------- | ----------------------------------------------- |
| Desktop Framework   | Tauri 2 (Rust edition 2024)                     |
| Frontend            | React 19, TypeScript, Vite                      |
| Styling             | TailwindCSS v4                                  |
| UI Components       | shadcn/ui (built on Radix UI), Lucide Icons     |
| State Management    | Zustand + Immer                                 |
| Database            | SQLite + sqlx                                   |
| LLM Framework       | Rig (Rust)                                      |
| MCP Integration     | rmcp (stdio, Streamable HTTP transports)        |
| Markdown            | react-markdown, remark-gfm, KaTeX               |
| Charts              | Mermaid                                         |
| Syntax Highlighting | react-syntax-highlighter                        |
| Toasts              | Sonner                                          |

### Key Libraries

- **Tauri 2**: Lightweight, secure desktop framework
- **Rig**: Modular LLM application framework in Rust
- **rmcp**: Model Context Protocol SDK for Rust (HTTP & STDIO transports)
- **shadcn/ui**: Re-usable components built with Radix UI and TailwindCSS
- **Zustand + Immer**: Simple state management with immutable updates
- **sqlx**: Async SQL toolkit with compile-time checks

## Styleguides

### Git Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Keep messages concise and descriptive

### Code Style

Follow the guidelines below when writing code:

#### TypeScript/React

**Formatting (Prettier)**

- No semicolons at line ends
- Single quotes for strings
- 2-space indentation
- Trailing commas (ES5 compatible)
- 100 character line width

**Imports**

- Group imports in order: React → external libraries → internal components/lib → types
- Use path aliases: `import X from '@/components/X'`
- Named imports for libraries: `import { useState } from 'react'`

**Naming Conventions**

- Components: PascalCase (`ChatInput`, `MessageList`)
- Hooks: camelCase with `use` prefix (`useSubmitHandler`)
- Variables/functions: camelCase (`conversationId`, `fetchModels`)
- Constants: SCREAMING_SNAKE_CASE for config values
- Interfaces: PascalCase, no `I` prefix (`ConversationSettings`)
- Types: Same as interfaces

**TypeScript**

- Enable strict mode
- No unused locals or parameters
- Use type inference where clear, explicit types where needed
- Avoid `any`, use `unknown` or proper types
- Generics for reusable utilities

**React Patterns**

- Functional components with hooks
- Component file structure: exports at bottom
- Split complex hooks into separate files in `hooks/` directory
- Use Zustand with Immer for state: `create<Store>()(immer((set, get) => ({ ... })))`
- Prop types via TypeScript interfaces

**Error Handling**

- Use try/catch for async operations
- Log errors via `@/lib/logger`
- Convert errors to strings with `String(error)` before storing

**Logging**

```typescript
import { logger } from '@/lib/logger'
logger.info('message', { context })
logger.error('Failed to load:', error)
```

#### Rust

**Formatting (rustfmt)**

- Edition 2024
- Max line width: 100 characters
- Run `pnpm format:rust` before committing

**Naming Conventions**

- Modules: snake_case
- Structs/enums: PascalCase
- Functions: snake_case
- Variables: snake_case
- Constants: SCREAMING_SNAKE_CASE
- Trait methods: snake_case

**Error Handling**

- Use `anyhow` for application errors
- Use `thiserror` for library/struct errors
- Propagate with `?` operator

**Async/Await**

- Use `tokio` runtime (fully featured)
- Database operations are async via sqlx

**Logging (tracing)**

```rust
tracing::info!("message");
tracing::error!("Failed to: {}", error);
```

**Code Organization**

- `src-tauri/src/` structure:
  - `commands/` - Tauri command handlers
  - `db/` - Database schema and operations
  - `models/` - Data models (DTOs)
  - `llm/` - LLM integration
  - `mcp/` - MCP server management and tool integration
  - `web_fetch/` - Web scraping
  - `web_search/` - Search functionality
  - `lib.rs` - Module declarations and app entry

#### Database (SQLite + sqlx)

- Primary keys: UUID v7 format
- Use sqlx macros for queries
- Be mindful of transaction deadlocks; release locks promptly

### Project Structure

```
chatshell-desktop/
├── src/                       # React frontend
│   ├── components/            # UI components
│   │   ├── chat-input/        # Chat input with attachments
│   │   ├── chat-view/         # Chat conversation view
│   │   ├── message-list-item/ # Message rendering
│   │   └── provider-settings/ # Provider configuration
│   ├── hooks/                 # Custom React hooks
│   ├── stores/                # Zustand state stores
│   ├── lib/                   # Utilities
│   └── types/                 # TypeScript definitions
├── src-tauri/                 # Rust backend
│   ├── src/
│   │   ├── commands/          # Tauri IPC handlers
│   │   ├── db/                # Database layer
│   │   ├── llm/               # LLM integration
│   │   ├── mcp/               # MCP server management
│   │   ├── models/            # Data models
│   │   ├── web_search/        # Search functionality
│   │   └── web_fetch/         # Web scraping
│   └── Cargo.toml
└── package.json
```

### Testing

All tests must pass before merging:

```bash
# Frontend
pnpm check

# Backend
pnpm check:rust
```

### Available Commands

```bash
pnpm dev              # Start Vite dev server (frontend only)
pnpm build            # TypeScript compile + Vite build
pnpm preview          # Preview production build
pnpm lint             # Run ESLint
pnpm lint:fix         # Auto-fix ESLint issues
pnpm format           # Auto-format with Prettier
pnpm format:check     # Check Prettier formatting
pnpm type-check       # TypeScript type checking
pnpm check            # Full check: type-check + lint + format
pnpm check:rust       # Rust format check + clippy
pnpm format:all       # Format TypeScript + Rust
pnpm tauri dev        # Start development app
pnpm tauri build      # Build release bundle
```

### Consider Opening Draft Pull Requests

Not all PRs are ready for review when created. Please consider creating [draft pull requests](https://github.blog/2019-02-14-introducing-draft-pull-requests/) if:

- You want to start a discussion
- You're not sure if changes are heading in the right direction
- Changes are not yet complete

## Reporting Bugs

1. **Ensure the bug was not already reported** by searching on GitHub under [Issues](https://github.com/chatshellapp/chatshell-desktop/issues)
2. If you're unable to find an open issue addressing the problem, [open a new one](https://github.com/chatshellapp/chatshell-desktop/issues/new)
3. Include:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment information (OS, version, etc.)

## Suggesting Enhancements

Open a new issue with:

- Clear title
- Detailed description of the proposed feature
- Use cases and rationale

## Important Notes

### Current Restrictions 🚫

We are currently **NOT accepting feature PRs** as the project is in pre-v1.0 development phase. The API and data models may change frequently.

We encourage contributions for:

- Bug fixes
- Performance improvements
- Documentation updates
- UI enhancements and minor refactors

## Contact

If you have any questions or suggestions:

- [GitHub Issues](https://github.com/chatshellapp/chatshell-desktop/issues)
- [Community Discussions](https://github.com/chatshellapp/chatshell-desktop/discussions)

Thank you for contributing to ChatShell!
