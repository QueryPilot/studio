# AI Assistant Specification

**Version:** 2.0  
**Status:** ✅ Implemented  
**Last Updated:** October 30, 2025

---

## Overview

The AI Assistant provides an intelligent chat interface for database interactions, powered by multiple AI providers (OpenAI, Anthropic, Google, Ollama) running through a secure Bun HTTP sidecar process.

### Architecture

```
Frontend (React/TypeScript)
    ↓
Tauri Commands (Rust)
    ↓
AI Sidecar (Bun HTTP Server)
    ↓
AI Providers (OpenAI, Anthropic, Google, Ollama)
```

---

## Core Components

### 1. AI Sidecar (`src-tauri/sidecar-ai/`)

**Technology:** Bun HTTP Server (standalone executable)

**Endpoints:**

- `GET /health` - Health check
- `POST /config` - Configure API keys (called on startup)
- `POST /chat` - Stream AI responses via SSE

**Features:**

- In-memory API key storage (loaded from Tauri backend)
- Multi-provider support with dynamic provider selection
- Server-Sent Events (SSE) streaming for real-time responses
- CORS configuration for Tauri webview communication
- Tool calling support for database operations

**Build:**

```bash
pnpm build:ai-sidecar
```

Outputs: `src-tauri/sidecars/ai-server-{platform-triple}`

---

### 2. Backend (Rust - `src-tauri/src/ai/`)

#### Manager (`manager.rs`)

- Orchestrates AI services and sidecar lifecycle
- Loads API keys from keychain on startup
- Sends keys to sidecar via POST `/config`

#### Sidecar Manager (`sidecar.rs`)

- Manages sidecar process lifecycle
- Finds available port and starts server
- Health checks and configuration

#### Secure Storage (`secure_storage.rs`)

- OS-level keychain integration (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- Commands: `get_ai_api_key`, `set_ai_api_key`, `delete_ai_api_key`

#### Commands (`commands.rs`)

- `get_ai_providers()` - Lists all providers and models
- `get_configured_providers()` - Returns providers with API keys set
- `reload_ai_api_keys()` - Reloads keys from keychain and sends to sidecar
- `get_ai_sidecar_url()` - Returns sidecar URL for frontend
- `debug_sidecar_status()` - Diagnostic command for debugging

---

### 3. Frontend Components

#### AIAssistantSidebar (`src/components/AIAssistant/AIAssistantSidebar.tsx`)

**Features:**

- Chat message history with markdown rendering
- Real-time streaming responses
- @mention support for tables/views
- Model switching mid-conversation
- Error handling and reconnection

**State Management:**

- Uses `useChat` hook from `@ai-sdk/react`
- Tracks current provider based on selected model
- Auto-scrolls to latest message
- Handles configuration check

#### ModelSelector (`src/components/AIAssistant/ModelSelector.tsx`)

**Features:**

- Dropdown showing all models from configured providers only
- Grouped by provider with visual hierarchy
- Shows "Default" and "Active" badges
- One-click model switching
- Toast notification on change

**UI:**

```
Model: gpt-5-2025-08-07 [openai] ▼
├── OpenAI (Default)
│   ├── gpt-5-2025-08-07 [Active]
│   ├── gpt-5-pro-2025-10-06
│   └── gpt-5-mini-2025-08-07
├── Anthropic
│   ├── claude-sonnet-4-5
│   └── claude-haiku-4-5
└── Google
    ├── gemini-3-pro
    └── gemini-3-flash
```

#### AutoResizeTextarea (`src/components/AIAssistant/AutoResizeTextarea.tsx`)

**Features:**

- Auto-expands from 2 to 10 rows as user types
- Smooth CSS transitions
- Scrolls when content exceeds max height
- Keyboard shortcuts (Cmd/Ctrl+Enter to send)

#### MentionAutocomplete (`src/components/AIAssistant/MentionAutocomplete.tsx`)

**Features:**

- Triggers on `@` key
- Shows tables and views from current database
- Keyboard navigation (↑↓, Enter/Tab, Esc)
- Inserts: `@table/schema.tablename` or `@view/schema.viewname`

**Flow:**

```
User types: "Show me @us"
Autocomplete appears:
  📋 users (public)
  📋 user_sessions (public)
  👁️ user_stats_view (analytics)
User selects → "Show me @table/public.users"
```

---

### 4. State Management (`src/stores/aiStore.ts`)

**Store Structure:**

```typescript
interface AIStoreState {
  selectedProvider: string; // Default provider in settings
  defaultModels: Record<string, string>; // Default model per provider
  activeModel: string; // Current chat model (can override)
  providers: AIProviderConfig[]; // Cached providers list
  configuredProviders: string[]; // Providers with API keys set
  isInitialized: boolean; // Startup loading flag
}
```

**Default Models (October 2025):**

```typescript
{
  openai: "gpt-5-2025-08-07",
  anthropic: "claude-sonnet-4-5",
  google: "gemini-3-pro",
  ollama: "llama3.1"
}
```

---

## Supported AI Models

### OpenAI (Official IDs - Oct 2025)

| Model      | ID                      | Description               |
| ---------- | ----------------------- | ------------------------- |
| GPT-5      | `gpt-5-2025-08-07`      | Flagship model for coding |
| GPT-5 Pro  | `gpt-5-pro-2025-10-06`  | Advanced reasoning        |
| GPT-5 Mini | `gpt-5-mini-2025-08-07` | Fast, cost-efficient      |
| GPT-5 Nano | `gpt-5-nano-2025-08-07` | Fastest                   |
| GPT-4.1    | `gpt-4.1-2025-04-14`    | Smartest non-reasoning    |

**Requires:** OpenAI API key  
**Pricing:** Variable by model

---

### Anthropic Claude (API Aliases - Oct 2025)

| Model             | API Alias           | Full ID                      | Description            |
| ----------------- | ------------------- | ---------------------------- | ---------------------- |
| Claude Sonnet 4.5 | `claude-sonnet-4-5` | `claude-sonnet-4-5-20250929` | Best for coding/agents |
| Claude Haiku 4.5  | `claude-haiku-4-5`  | `claude-haiku-4-5-20251001`  | 4-5x faster            |
| Claude Opus 4.1   | `claude-opus-4-1`   | `claude-opus-4-1-20250805`   | Specialized reasoning  |

**Legacy Models:**

- `claude-3-opus-20240229`
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`

**Requires:** Anthropic API key  
**Pricing:** Sonnet ($3/$15), Haiku ($1/$5), Opus ($15/$75)

---

### Google Gemini (Latest - June 2025)

| Model                 | ID                    | Context   | Description               |
| --------------------- | --------------------- | --------- | ------------------------- |
| Gemini 2.5 Pro        | `gemini-3-pro`        | 1M tokens | State-of-the-art thinking |
| Gemini 2.5 Flash      | `gemini-3-flash`      | 1M tokens | Best price-performance    |
| Gemini 2.5 Flash-Lite | `gemini-3-flash-lite` | 1M tokens | Ultra-fast                |

**Legacy Models:**

- `gemini-2.0-flash` (1M tokens)
- `gemini-2.0-flash-lite` (1M tokens)

**Requires:** Google AI API key  
**Features:** Thinking mode, function calling, code execution, multimodal

---

### Ollama (Local)

| Model            | Description                       |
| ---------------- | --------------------------------- |
| `llama3.1`       | Meta's latest Llama (recommended) |
| `llama3`         | Meta's Llama 3                    |
| `codellama`      | Code-specialized Llama            |
| `mistral`        | Mistral AI's model                |
| `qwen2.5`        | Alibaba's Qwen 2.5                |
| `deepseek-coder` | DeepSeek code model               |

**Requires:** Ollama installed locally  
**No API key needed**

---

## Security Architecture

### API Key Storage

**OS-Level Keychain:**

- **macOS:** Keychain Access
- **Windows:** Credential Manager
- **Linux:** Secret Service API

**Service Name Format:** `dev.querypilot.studio.ai_api_key_{provider}`

**Flow:**

```
User enters API key → Settings Panel
         ↓
invoke("set_ai_api_key")
         ↓
Rust: keyring::Entry::new()
         ↓
OS Keychain prompts for password (first time)
         ↓
Key stored securely
         ↓
invoke("reload_ai_api_keys")
         ↓
Rust reads from keychain
         ↓
POST /config to sidecar
         ↓
Sidecar stores in memory
         ↓
Ready for AI requests ✅
```

### CORS Configuration

**Sidecar CORS Headers:**

- `tauri://localhost` (production)
- `http://localhost:1420` (development)
- `http://127.0.0.1:1420` (development)

Dynamic origin detection based on request origin.

---

## Application Startup Flow

### 1. Main Application (`main.rs`)

```rust
#[tauri::command]
async fn setup(app_handle: AppHandle) {
    // Initialize AI manager
    let ai_manager = Arc::new(AIManager::new());

    // Start AI sidecar
    ai_manager.initialize_sidecar().await?;

    // Sidecar is now running on random port
}
```

### 2. AI Manager Initialization (`manager.rs`)

```rust
pub async fn initialize_sidecar(&self) -> Result<()> {
    // Start sidecar process
    let port = self.sidecar_manager.start().await?;

    // Load API keys from keychain and send to sidecar
    self.load_and_configure_api_keys().await?;

    Ok(())
}
```

### 3. Frontend Initialization (`App.tsx`)

```typescript
useEffect(() => {
  // Load configured providers on startup
  const providers = await invoke("get_configured_providers");
  setConfiguredProviders(providers);
  setInitialized(true);

  // Example: ["google", "ollama"] if only Google is configured
}, []);
```

### 4. Result

- Sidecar running on port (e.g., `http://localhost:53834`)
- API keys loaded in sidecar memory
- Frontend knows which providers are configured
- Model selector shows ONLY configured providers
- Ready to chat! ✅

---

## User Workflows

### First-Time Setup

1. **App loads** → Sidecar starts → No API keys found
2. **AI Sidebar** → Shows "Configuration Required"
3. **User clicks Settings icon** → Opens Preferences → AI Runtime
4. **Select provider** (e.g., Google) → Enter API key
5. **macOS prompts for keychain password** (first time only)
6. **Click Save** → Key stored in keychain
7. **Backend reloads keys** → Sends to sidecar
8. **Frontend updates** → Model selector shows Google + Ollama models
9. **AI Sidebar** → Hides "Configuration Required" ✅

### Normal Usage

1. **Open workspace** → Click Bot icon (right sidebar)
2. **Model selector** shows current model (e.g., `gpt-5-2025-08-07`)
3. **Type message** in growing textarea
4. **Use `@` for tables** → Autocomplete appears
5. **Press Cmd+Enter or click Send** → Message streams in real-time
6. **Switch model anytime** → Click model dropdown → Select new model
7. **Continue conversation** with new model ✅

### Model Switching Mid-Conversation

1. **User chatting with GPT-5**
2. **Clicks model selector** → Dropdown shows all configured models
3. **Selects Gemini 2.5 Pro** → Toast: "Switched to gemini-3-pro (google)"
4. **Next message uses Gemini** → Provider auto-updated ✅
5. **Previous messages remain** → Context preserved

---

## Configuration Options

### Settings Panel (`AIPanel.tsx`)

**Purpose:** Provider and API key management ONLY

**UI:**

```
AI Runtime
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Sidecar Status: 🟢 Online

┌─ Provider Selection ─────────────┐
│ Selected Provider: [OpenAI ▼]    │
└───────────────────────────────────┘

┌─ Default Model ──────────────────┐
│ [gpt-5-2025-08-07 ▼]            │
└───────────────────────────────────┘

┌─ API Key ────────────────────────┐
│ [••••••••••••••••••]    [Save]  │
└───────────────────────────────────┘
```

**Actions:**

- Select provider → Load default model
- Enter API key → Save to keychain
- Save → Reload keys in sidecar → Update configured providers list

**What's NOT in Settings:**

- ❌ Active model selection (moved to chat UI)
- ❌ Model switching (done in chat)

---

## Error Handling

### Common Errors and Solutions

#### 1. "Configuration Required" Shows When Provider IS Configured ❌

**Cause:** `configuredProviders` not loaded on startup

**Solution:**

- Added `get_configured_providers()` command
- Called in `App.tsx` on mount
- Checks keychain and returns list of configured providers
- Frontend updates store → Model selector filters correctly

#### 2. "Google API key not configured" ❌

**Cause:** API key not in sidecar memory

**Debug:**

```javascript
// In DevTools console
await invoke("debug_sidecar_status");
// Check if sidecar is running

await invoke("get_configured_providers");
// Should include "google" if configured
```

**Solution:**

- Restart app → Sidecar reloads keys on startup
- Or save API key again → Triggers `reload_ai_api_keys()`

#### 3. Provider/Model Mismatch (e.g., Gemini sent to Ollama) ❌

**Cause:** Frontend used `selectedProvider` (default) instead of actual provider for model

**Solution:**

- Added `currentProvider` state in `AIAssistantSidebar`
- `ModelSelector` passes both provider and model on change
- `onModelChange={(provider, model) => setCurrentProvider(provider)}`
- Chat request uses `currentProvider` ✅

#### 4. Timeout After 10 Seconds ❌

**Cause:** API key not reaching the AI provider

**Solution:**

- Keys now loaded on startup and sent to sidecar
- Sidecar stores in memory: `apiKeys[provider]`
- When chat request arrives, uses stored key
- No timeout! ✅

---

## Database Tool Integration (Future)

### Planned Tools

```typescript
const tools = {
  list_tables: {
    description: "List all tables in the current database",
    parameters: { schema: string },
  },

  get_table_structure: {
    description: "Get columns, types, and constraints for a table",
    parameters: { table: string, schema: string },
  },

  execute_readonly_query: {
    description: "Execute a SELECT query (read-only)",
    parameters: { query: string },
  },

  get_table_sample: {
    description: "Get sample rows from a table",
    parameters: { table: string, limit: number },
  },
};
```

### Tool Calling Flow

```
User: "Show me all users with email ending in @gmail.com"
         ↓
AI generates tool call:
{
  tool: "execute_readonly_query",
  query: "SELECT * FROM users WHERE email LIKE '%@gmail.com'"
}
         ↓
Sidecar → HTTP POST to Tauri backend
         ↓
Rust executes query securely
         ↓
Returns results to sidecar
         ↓
Sidecar sends to AI model
         ↓
AI formats results for user
         ↓
User sees: "Found 42 users with @gmail.com emails: ..."
```

---

## Testing & Diagnostics

### Manual Testing Checklist

- [ ] **Startup:** App loads without errors
- [ ] **Sidecar:** Health check passes (`/health` returns 200)
- [ ] **Providers:** `get_configured_providers()` returns correct list
- [ ] **Model Selector:** Shows ONLY configured providers
- [ ] **Configuration Required:** Hidden when ANY provider configured
- [ ] **API Key Save:** Successfully stores in keychain
- [ ] **Reload:** Keys sent to sidecar after save
- [ ] **Chat:** Message sends without timeout
- [ ] **Streaming:** Response streams in real-time
- [ ] **Model Switch:** Dropdown shows all models from configured providers
- [ ] **Provider Auto-detect:** Switching to Gemini model sets provider to "google"
- [ ] **@Mentions:** Typing `@` shows table/view autocomplete
- [ ] **Keyboard Nav:** Arrow keys work in autocomplete
- [ ] **Growing Textarea:** Expands from 2-10 rows smoothly

### Diagnostic Commands

```javascript
// Check configured providers
await invoke("get_configured_providers");

// Check sidecar status
await invoke("debug_sidecar_status");

// Check sidecar URL
await invoke("get_ai_sidecar_url");
```

### Expected Logs on Startup

```
AI Sidecar server running on http://localhost:53834
✅ Loaded API key for provider: google
✅ API keys configured for sidecar
✅ Loaded configured providers on startup: ["google", "ollama"]
📋 Configured providers: ["google", "ollama"]
```

---

## Build & Deployment

### Development

```bash
# Install dependencies
pnpm install
cd src-tauri/sidecar-ai && bun install

# Build sidecar
pnpm build:ai-sidecar

# Run dev mode
make d
```

### Production Build

```bash
# Build everything (including sidecar)
pnpm build

# Build Tauri app (bundles sidecar)
pnpm tauri:build
```

### Platform-Specific Binaries

**Sidecar naming convention:**

- `ai-server-aarch64-apple-darwin` (macOS ARM)
- `ai-server-x86_64-apple-darwin` (macOS Intel)
- `ai-server-x86_64-pc-windows-msvc.exe` (Windows)
- `ai-server-x86_64-unknown-linux-gnu` (Linux)

Tauri automatically selects correct binary at runtime.

---

## Known Limitations

1. **Model Context:** Chat history not persisted between app restarts
2. **Tool Calls:** Database tools implemented but not fully tested
3. **Error Recovery:** Limited retry logic on network failures
4. **Rate Limiting:** No built-in rate limit handling
5. **Cost Tracking:** No token usage or cost monitoring
6. **Multi-turn Context:** @mentions not remembered across messages

---

## Future Enhancements

### Phase 3: Enhanced Features

1. **Chat Persistence:**

   - Save conversation history to local DB
   - Resume previous chats
   - Export conversations as markdown

2. **Advanced @mentions:**

   - `@query/saved_query_name` - Reference saved queries
   - `@schema/public` - Show entire schema
   - Preview on hover
   - Smart context injection

3. **Tool Visualization:**

   - Show SQL queries being executed
   - Display intermediate results
   - Expandable tool call details
   - Syntax highlighting

4. **Multi-turn Context:**

   - Remember previous table mentions
   - Smart follow-up questions
   - Context-aware suggestions

5. **Cost Monitoring:**
   - Track tokens used per provider
   - Estimated cost per conversation
   - Usage analytics dashboard

---

## References

### Official Documentation

- **OpenAI:** https://platform.openai.com/docs/models
- **Anthropic:** https://docs.anthropic.com/claude/docs/models-overview
- **Google Gemini:** https://ai.google.dev/gemini-api/docs/models
- **Ollama:** https://ollama.ai/library
- **AI SDK:** https://sdk.vercel.ai/docs

### Internal Documentation

- Architecture Decision Records: `docs/adr/`
- API Specification: `docs/api.spec.md`
- Workbench Specification: `docs/workbench.spec.md`

---

## Changelog

### v2.0 - October 30, 2025

- ✅ Implemented Bun HTTP sidecar architecture
- ✅ Added multi-provider support (OpenAI, Anthropic, Google, Ollama)
- ✅ Implemented secure keychain storage for API keys
- ✅ Created Cursor-style chat UI with growing textarea
- ✅ Added in-chat model selector dropdown
- ✅ Implemented @mention autocomplete for tables/views
- ✅ Updated to latest October 2025 models
- ✅ Fixed provider auto-detection on model switch
- ✅ Fixed API key loading on startup
- ✅ Fixed "Configuration Required" logic

### v1.0 - Initial Implementation

- Basic AI chat interface
- Single provider support
- Fixed model selection

---

**Status:** ✅ Production Ready  
**Maintained By:** DevDB Studio Team  
**Last Review:** October 30, 2025
