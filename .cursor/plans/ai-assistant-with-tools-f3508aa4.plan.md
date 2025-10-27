<!-- f3508aa4-ba5e-401f-ab22-af67a12a97eb 5d7fbd85-a649-4266-a613-ceefc983a619 -->
# AI Assistant with AI SDK and Database Tools

## Architecture Overview

**Hybrid sidecar approach:** Bun HTTP server → Tauri commands → React frontend with AI SDK UI

## 1. Bun Sidecar Setup

Create a standalone Bun executable that runs as a Tauri sidecar:

- **Create** `src-tauri/sidecar-ai/` directory structure
- **Implement** HTTP server with endpoints: `/chat/stream`, `/health`
- **Configure** Tauri to bundle Bun executable in `tauri.conf.json`
- **Build script** to compile Bun standalone executable using `bun build --compile`

Key files:

- `src-tauri/sidecar-ai/index.ts` - Main server
- `src-tauri/sidecar-ai/package.json` - Dependencies
- `src-tauri/sidecar-ai/tools/` - Tool definitions

## 2. AI SDK Integration in Sidecar

Install and configure AI SDK with multiple providers:

- **Install** `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `ollama-ai-provider`
- **Create** `POST /chat/stream` endpoint using `streamText` from AI SDK
- **Implement** provider factory that switches based on config
- **Add** tool definitions for database operations (20+ tools total)

Reference: [AI SDK streamText](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)

## 3. Tool Definitions (Full Suite)

Implement comprehensive database tools in `src-tauri/sidecar-ai/tools/`:

**Core Tools:**

- `list_tables` - Get all tables in schema
- `get_table_structure` - Columns, types, constraints
- `get_sample_data` - Execute SELECT with LIMIT
- `execute_readonly_query` - Run SELECT queries safely

**Extended Tools:**

- `get_indexes` - Table indexes
- `get_triggers` - Table triggers
- `get_foreign_keys` - Relationships
- `explain_query` - Query execution plan
- `get_table_statistics` - Row counts, size

**Full Suite:**

- `search_schema` - Search tables/columns by name
- `get_saved_queries` - User saved queries
- `get_query_history` - Recent query history
- `get_erd_data` - ERD relationships
- `get_functions` - Database functions/procedures
- `get_views` - Database views

Each tool calls Tauri backend via HTTP client.

## 4. Tauri Sidecar Management

Update Rust backend to manage Bun sidecar lifecycle:

- **Add** `src-tauri/src/ai/sidecar.rs` - Start/stop sidecar
- **Update** `src-tauri/src/ai/manager.rs` - Initialize sidecar on startup
- **Add** sidecar port management (random available port)
- **Store** sidecar handle for cleanup on shutdown

Reference sidecar APIs: `tauri::api::process::Command::new_sidecar()`

## 5. Frontend Integration with AI SDK UI

Refactor `AIAssistantSidebar.tsx` to use `useChat` hook:

```typescript
import { useChat } from '@ai-sdk/react';

const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
  api: '/api/ai/chat', // Proxied through Tauri
  onToolCall: async ({ toolCall }) => {
    // Handle client-side tool confirmations
  }
});
```

- **Replace** current message handling with `useChat`
- **Add** tool call rendering in message parts
- **Implement** message persistence using IndexedDB
- **Add** markdown rendering for assistant responses

Reference: [AI SDK UI Chatbot](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)

## 6. Provider Selection UI

Create settings panel for AI configuration:

- **Add** `src/components/Preferences/AIPreferences.tsx`
- **UI** for selecting provider (OpenAI, Anthropic, Google, Ollama)
- **API key inputs** with secure storage via `vaultStorage`
- **Model selection** dropdown per provider
- **Save** preferences to `preferencesStore`

Providers:

- OpenAI: gpt-4, gpt-4-turbo, gpt-3.5-turbo
- Anthropic: claude-3-opus, claude-3-sonnet, claude-3-haiku
- Google: gemini-pro, gemini-pro-vision
- Ollama: Local models

## 7. Tauri Command Bridge

Add commands to proxy sidecar requests:

- **Add** `send_ai_chat_message` command
- **Add** `get_ai_config` command
- **Add** `set_ai_config` command
- **Update** existing AI commands to work with sidecar

Store sidecar URL in app state, forward requests.

## 8. Tool Call Display

Enhanced message rendering with tool visibility:

- **Render** tool calls with collapsible UI
- **Show** tool inputs (e.g., "Querying table: users")
- **Display** tool results (formatted tables, JSON)
- **Add** loading states for tool execution
- **Error** handling for failed tools

Use `message.parts` to access typed tool parts.

Reference: [Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)

## 9. Build & Deploy Configuration

Setup build process for sidecar:

- **Add** `pnpm build:ai-sidecar` script
- **Compile** Bun executable: `bun build --compile --minify --sourcemap`
- **Copy** compiled binary to `src-tauri/sidecars/ai-server-{platform}`
- **Update** `tauri.conf.json` bundle resources
- **Cross-platform** builds for macOS, Windows, Linux

## 10. Testing & Documentation

- **Test** each tool individually
- **Test** multi-turn conversations
- **Test** tool call streaming
- **Add** README for AI sidecar setup
- **Document** tool capabilities in user-facing help

### To-dos

- [ ] Create Bun sidecar directory structure and basic HTTP server
- [ ] Install AI SDK packages in sidecar and configure providers
- [ ] Implement all 20+ database tool definitions
- [ ] Add Rust sidecar lifecycle management (start/stop/port)
- [ ] Refactor AIAssistantSidebar to use useChat hook
- [ ] Build AI provider selection and API key management UI
- [ ] Add Tauri commands to bridge sidecar communication
- [ ] Implement tool call rendering and result display
- [ ] Setup build scripts for compiling and bundling Bun sidecar
- [ ] Test all tools and conversation flows