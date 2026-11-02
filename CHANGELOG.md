# Changelog

All notable changes to ChatShell Desktop are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

Each release section is published as the GitHub release notes, the in-app update notes, and the [changelog on chatshell.app](https://chatshell.app/changelog/). A release cannot ship without its section.

## [Unreleased]

## [0.9.1] - 2026-11-01

### Fixed

- Links and files open again from inside the app.
- The macOS build is signed with its iCloud entitlements, so cross-device sync can read the iCloud container.

## [0.9.0] - 2026-10-31

### Added

- In-app updates. ChatShell checks for new versions, verifies every package with minisign, and installs only when you click.
- Tool approval. Choose between asking before each tool call and letting the assistant run tools without asking.
- Conversations are now a message tree. Edit or resend a message to branch, then switch between versions of a reply.
- A welcome screen and plainer first-run copy.
- Translation moves to a full-page split screen.
- Failed and waiting turns are shown in the transcript with a retry button.
- Conversation rows show a generating indicator while a reply streams.
- Bing as a web search engine, with the default engine picked from your time zone.
- Refreshed provider catalog and brand icons.

### Changed

- A new ink-black visual identity across the app.
- New conversations stay drafts until you send the first message.
- The sidebar starts collapsed to the icon rail.
- Each run's process steps are folded under a single header.
- More predictable transcript scrolling while replies stream.
- Switching conversations feels faster.

### Fixed

- A provider setup that cannot connect can now be repaired instead of blocking the app.
- Concurrent tool approval requests queue instead of overwriting each other, and grants are cleared when you switch modes.
- Sync backs off when the iCloud container is congested.
- Messages can no longer be sent while a reply is still streaming.
- Office documents preview through text extraction.
- Web fetch works again with the macOS WebView and with Obscura behind fake-IP proxies.
- Opening an old conversation no longer moves it to the top of the list.

## [0.8.3] - 2026-10-18

### Added

- Press Up and Down in the message box to browse your earlier prompts.
- Office documents can be attached and sent to models that read them.
- Search results are handed to tool-capable models on demand instead of all at once.
- The read tool can read a page range of a PDF.
- Web fetch falls back to a better fetcher when a page comes back empty or broken.

### Changed

- Long conversations scroll and stream much more smoothly.
- Large attachments are loaded on demand instead of being sent inline every turn.

### Fixed

- Screenshot export captures the whole conversation.

## [0.8.2] - 2026-10-14

### Added

- File edits made by the assistant are shown as grouped changes.

### Fixed

- Repeated context compaction in long conversations is more accurate and survives restarts.
- Clearer error messages when an edit is refused because the file changed.

## [0.8.1] - 2026-10-13

### Added

- Text-only models can take image input through a vision fallback model.
- Log storage management with size caps, plus an option to have AI diagnose a log.
- Settings show the version of the model capabilities database.
- A hint for installing Obscura in the web fetch settings.
- A redesigned About section.
- A splash screen while the app starts.

### Fixed

- Links, file dialogs, and file access work again.
- Startup no longer stalls while sync keys load.
- Sync onboarding handles a missing iCloud account and no longer leaves you stuck.

## [0.8.0] - 2026-10-13

### Added

- End-to-end encrypted cross-device sync through iCloud, with the key kept in iCloud Keychain.
- Sync setup as the last step of onboarding.
- Sidebar translator, with a button to continue the translation as a conversation.
- Auxiliary models: route small tasks to a tiny model and image questions to a vision model.
- Context compaction keeps long conversations within the model's window.
- Web fetch uses the system WebView, Obscura, or Chrome, depending on what a page needs.
- Richer rendering of tool results.

### Changed

- Updated model capabilities data, refreshed automatically.
- The sync passphrase flow matches the iOS app.

### Fixed

- Web search uses the provider you configured.
- Attachments repaired after a fetch display correctly.
- Ollama providers stay visible after auto-import during onboarding.

## [0.7.1] - 2026-07-20

### Added

- Export a question and its answer as a screenshot, including while the answer is still streaming.

### Fixed

- Follow-up turns with OpenAI Responses API models keep their tool call history.

## [0.7.0] - 2026-04-09

### Added

- A security policy that blocks dangerous shell commands and sensitive file paths for the built-in tools.

## [0.6.4] - 2026-04-08

### Changed

- Shell commands wrapped in harmless helpers are now checked by the security policy too.

## [0.6.3] - 2026-04-01

### Fixed

- Resending a message keeps its original attachments.

## [0.6.2] - 2026-03-27

### Added

- Paste a JSON config to import MCP servers.

### Changed

- Prompt caching is turned on for Anthropic models, which lowers the cost of multi-turn conversations.

### Fixed

- Environment variables for STDIO MCP servers are handled correctly, with clearer error details.

## [0.6.1] - 2026-03-11

### Changed

- Conversations are sorted by the time of their last message.
- Reasoning and tool call history is kept when you continue a conversation.

### Fixed

- Skills with the same name from different sources no longer conflict.
- The copy button copies messages that contain tool calls.
- The message box fills the input area after resizing.
- Several tool calling fixes for streaming reasoning, tool call IDs, and tool outputs.

## [0.6.0] - 2026-03-11

### Added

- Queue messages while a reply is still streaming.
- Skills from several source directories, with search.
- A built-in skill installer.
- Skills are rescanned when you start a conversation or open settings.

### Fixed

- Stopping a reply also stops its running shell command.
- Line numbers are no longer selected when you copy from a code block.
- Long model names no longer break the provider settings layout.
- Saving a new provider keeps the form and confirms the save.

## [0.5.1] - 2026-03-10

### Added

- Model capability awareness from bundled models.dev data.
- Image generation with Gemini 3.1 through OpenRouter.
- The system prompt includes basic environment details such as the OS and date.
- Linux builds.

### Fixed

- Images cannot be pasted or dropped for models without vision support.
- Duplicate messages and images during streaming.
- Removed skills no longer linger in the list.

## [0.5.0] - 2026-03-09

### Added

- Full-text search across your chat history.

## [0.4.12] - 2026-03-09

### Fixed

- Duplicate messages at the end of a reply.

## [0.4.11] - 2026-03-09

### Added

- Interface translations.

### Fixed

- Reasoning display for MiniMax and OpenRouter models.
- OAuth sign-in for MCP servers works again over HTTPS.
- Tool call previews.

## [0.4.9] - 2026-03-06

### Fixed

- On macOS, tools find commands on your shell `PATH` when the app is opened from Finder or the Dock.

## [0.4.6] - 2026-03-06

### Added

- A `kill_shell` tool, persistent shell sessions, and unified tool icons.
- Edit any model from its actions menu.

### Fixed

- Stopping a reply keeps the tool calls and reasoning produced so far.
- Provider API errors show the real details instead of a generic message.
- Duplicate tool names from lazily loaded MCP servers.

## [0.4.5] - 2026-03-04

### Fixed

- The stop button cancels running tool calls immediately.
- Only HTTP MCP servers are probed, and STDIO errors show the full cause.

## [0.4.3] - 2026-03-04

### Added

- `edit` and `write` tools, and the `read` tool can read images and PDFs.
- MCP server connection status and tool lists in settings.
- A prompt to sign in again when an MCP OAuth token expires.
- A connectivity check for provider APIs.
- MCP tool schemas load on demand.

### Changed

- Updated default models for each provider.
- MCP sign-in tokens are stored in the encrypted database instead of the OS keychain.

### Fixed

- Anthropic provider compatibility.
- The MCP refresh button reconnects the server.

## [0.4.1] - 2026-03-03

### Added

- Fork a conversation from any assistant message.
- Resend your own messages.
- OAuth 2.0 and bearer token sign-in for MCP servers.
- Export messages and conversations as screenshots.
- Consecutive tool calls collapse into a group, with icons by tool.
- Reasoning display for models that stream `reasoning_content` or `<think>` tags.

### Fixed

- Inserting a saved prompt places it at the cursor instead of replacing your text.

## [0.4.0] - 2026-03-02

### Added

- Every LLM provider supported by rig, plus MiniMax.
- Custom OpenAI-compatible and Anthropic-compatible providers.
- Add models by hand when a provider's model list cannot be fetched.
- Turn tools, skills, and MCP servers on or off in bulk.

## [0.3.0] - 2026-02-10

### Added

- Skills: reusable capabilities you can attach to assistants and conversations.
- Tools, built-in and MCP, can be configured per assistant.
- A working directory per conversation for the bash tool.

### Changed

- URLs in pasted text are no longer fetched automatically.

## [0.2.0] - 2026-01-05

### Added

- MCP support over HTTP and STDIO, with tool calls across multiple turns.
- New conversations inherit your globally enabled MCP servers.
- `web_search` and `web_fetch` as agent tools.
- Reasoning, tool calls, and text are shown in the order they happened.

## [0.1.1] - 2025-12-28

### Added

- First public release: a desktop AI chat app for your own providers, including OpenAI, Anthropic, Gemini, OpenRouter, and Ollama.
- Web search and web fetch, with a headless browser fallback.
- File, image, and web page attachments by paste, drag and drop, or URL.
- Assistants and a prompt library.
- Markdown rendering with syntax highlighting and Mermaid diagrams.
- API keys encrypted at rest.

[Unreleased]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.8.3...v0.9.0
[0.8.3]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.6.4...v0.7.0
[0.6.4]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.4.12...v0.5.0
[0.4.12]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.4.11...v0.4.12
[0.4.11]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.4.9...v0.4.11
[0.4.9]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.4.6...v0.4.9
[0.4.6]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.4.3...v0.4.5
[0.4.3]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.4.1...v0.4.3
[0.4.1]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/chatshellapp/chatshell-desktop/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/chatshellapp/chatshell-desktop/releases/tag/v0.1.1
