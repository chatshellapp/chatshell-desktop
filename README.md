# ChatShell

A desktop AI agent with built-in web search, file editing, and shell tools.

**Status:** In active development. Features and behavior may change between releases.

Connect a cloud AI provider or a local model, then use it to research topics, work with files, and run commands. Built-in tools work without plugins or MCP servers; additional integrations are optional.

Available for macOS, Windows, and Linux. Licensed under [Apache 2.0](LICENSE).

[Download ChatShell](https://github.com/chatshellapp/chatshell-desktop/releases/latest) · [Documentation](https://chatshell.app/docs)

---

## Quick Start

1. [Download and install ChatShell](https://github.com/chatshellapp/chatshell-desktop/releases/latest) for your platform.
2. Connect an AI provider with your API key, or configure a local model through Ollama or LM Studio.
3. Select a model that supports tool use, then send:

```text
Find things to do in Kyoto on a rainy day and group them by neighborhood.
```

ChatShell can use its built-in search and fetch tools to gather information and return a summary. In Ask mode, review and approve tool calls before they run.

---

## Example Tasks

Try these prompts with a model that supports tool use:

- **Plan a trip:** `Find things to do in Kyoto on a rainy day and group them by neighborhood.`
- **Choose a purchase:** `Compare three robot vacuums under $400, including recurring costs and common complaints.`
- **Plan meals:** `Suggest five dinners for two using rice, eggs, spinach, and chicken. Save a shopping list for anything else needed.`
- **Organize files:** `Look through my Downloads folder and suggest how to organize it. Wait for my approval before moving anything.`

Results depend on the selected model, enabled tools, and available permissions.

See [more example tasks](docs/example-tasks.md) for research, coding, automation, and creative prompts.

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

- **Tools included:** Search the web, read and edit files, and run shell commands without installing plugins or configuring external tool servers.
- **Cloud or local models:** Connect your preferred provider or use a local model through Ollama or LM Studio.
- **Reusable assistants:** Save model, prompt, tool, and skill selections for different tasks.
- **Local history:** Conversations are stored in SQLite on your device. Cloud providers receive the content you send them; optional iCloud sync uploads encrypted copies.
- **Optional extensions:** Add reusable instructions through skills, or connect external tools through the Model Context Protocol (MCP).

ChatShell provides the desktop interface and tools; you supply the model connection. Available capabilities depend on the selected model.

---

## More Features

- **Keep conversations useful:** Search past messages, branch a conversation, and export replies as Markdown or images.
- **Work with attachments:** Add documents, images, and web pages. Image understanding and generation require compatible models.
- **Translate text:** Use the sidebar translator, then continue in a conversation for follow-up questions.
- **Reuse your setup:** Save prompts and assistants for tasks you do regularly.
- **Choose tool permissions:** Review tool calls in Ask mode or allow autonomous execution in YOLO mode.
- **Sync optionally:** Sync encrypted conversation history and attachments through iCloud Drive on supported macOS and iOS builds.

See the [feature guide](docs/features.md) for tool details, provider configuration, skills, integrations, and storage behavior.

---

## Resources

- [Documentation](https://chatshell.app/docs)
- [Development and contributing](CONTRIBUTING.md)
- [Report a bug](https://github.com/chatshellapp/chatshell-desktop/issues)
- [Report a security vulnerability](https://github.com/chatshellapp/chatshell-desktop/security/advisories)
- [Apache 2.0 license](LICENSE)
- [Acknowledgements](docs/acknowledgements.md)
