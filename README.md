# OpenMinis PC

**Your private, on-device AI agent — now as a native Desktop application.**

A PC port of the [OpenMinis](https://github.com/OpenMinis/OpenMinis) iOS/Android
app. Runs as a native Windows desktop application with a real shell, file system
access, and web browsing — no browser needed.

## 🚀 Quick Start

### One-click launch (Windows)
```
双击 start-electron.bat
```

This will:
1. Compile TypeScript
2. Launch the native Electron desktop window
3. OpenMinis appears as a standalone window (not in a browser)

### CLI mode (for testing)
```bash
npm start
# Opens http://localhost:19840 in your browser
```

## 🖥️ Desktop App (Electron)

The native desktop app uses Electron to create a real Windows window:
- **No browser needed** — runs as a standalone `.exe` window
- **Dark theme UI** — matches the iOS OpenMinis design
- **System tray ready** — minimize to background
- **Native file dialogs** — for file operations

### First-time setup

If Electron is not cached, the launcher auto-downloads it:
1. `node download_electron.js` — downloads Electron (~111MB)
2. `node extract_electron.js` — extracts the binary
3. Then run `start-electron.bat`

## ⚙️ Configuration

1. Click **⚙️ Settings** in the sidebar
2. Choose your AI provider (Anthropic/OpenAI/Gemini/OpenRouter/xAI)
3. Enter your API key
4. Enter model name (e.g. `claude-sonnet-4-20250514`)
5. Click **Save Settings**

Settings stored in `workspace/.minis-settings.json`

## 🧩 Architecture (mirrors iOS OpenMinis)

| iOS (Swift) | PC (TypeScript) |
|---|---|
| `AIChatViewModel.runAgentLoop()` | `AgentLoop.ts` |
| `AgentProvider` protocol | `LLMProvider` interface |
| `AnthropicAgentProvider` | `AnthropicProvider.ts` |
| `OpenAIAgentProvider` | `OpenAIProvider.ts` |
| `GeminiAgentProvider` | `GeminiProvider.ts` |
| `makeAgentTools()` | `ToolDefinitions.ts` |
| `ISHExecutionCoordinator` | `ShellExecutor` |
| `file_read/write/edit` | `FileTools` |
| `browser_use` | `BrowserFetch` |
| `baseSystemPrompt` | `SystemPrompt.ts` |
| SwiftUI Chat View | `index.html` + `app.js` |

## 🔧 Tools

| Tool | Description |
|---|---|
| `shell_execute` | Execute system shell commands |
| `file_read` | Read files with offset/limit/tail |
| `file_write` | Create or overwrite files |
| `file_edit` | String replacement editing |
| `browser_fetch` | Fetch and parse web content |
| `memory_write` | Save persistent memories |
| `memory_get` | Search memories by keywords |

## 📁 Project Structure

```
openminis-pc/
├── electron-entry.js       # Electron main process
├── start-electron.bat      # One-click launcher
├── download_electron.js    # Electron downloader
├── extract_electron.js     # Electron extractor
├── package.json
├── tsconfig.json
├── src/
│   ├── main/
│   │   ├── server.ts       # HTTP + SSE server
│   │   ├── agent/
│   │   │   ├── AgentLoop.ts
│   │   │   └── SystemPrompt.ts
│   │   ├── providers/
│   │   │   ├── types.ts
│   │   │   ├── ProviderFactory.ts
│   │   │   ├── AnthropicProvider.ts
│   │   │   ├── OpenAIProvider.ts
│   │   │   └── GeminiProvider.ts
│   │   └── tools/
│   │       ├── ToolDefinitions.ts
│   │       └── ToolExecutors.ts
│   └── renderer/
│       ├── index.html
│       ├── styles.css
│       └── app.js
└── dist/                   # Compiled output
```

## 🛠️ Tech Stack

- **Desktop**: Electron 28 (native Windows window)
- **Backend**: Node.js + TypeScript
- **Frontend**: Vanilla HTML/CSS/JS + Marked.js
- **Streaming**: Server-Sent Events (SSE)
- **No browser required** for desktop mode

## 📄 License

GPLv3 — same as upstream [OpenMinis](https://github.com/OpenMinis/OpenMinis).
