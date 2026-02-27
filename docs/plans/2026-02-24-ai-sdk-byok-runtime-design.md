# AI SDK BYOK Runtime Design

**Date:** 2026-02-24
**Status:** Approved
**Goal:** Replace the custom Ollama Rust integration with a unified BYOK (Bring Your Own Key) AI runtime built on Vercel AI SDK v6, running entirely in the frontend.

---

## 1. Problem

The current AI architecture has two disconnected paths:

- **ACP agents** (Claude Code, Codex, OpenCode) — full agentic coding with MCP tools, but require installing separate CLI binaries and cloud API subscriptions
- **Ollama** — custom Rust HTTP client (`ollama.rs`, `OllamaManager`), chat-only, no tool calling, no other providers

Users who want to use their own API keys (OpenAI, Anthropic, Google, Mistral) or local models (Ollama) have no path. The Ollama integration is a dead-end — chat-only, no tools, custom plumbing that duplicates what AI SDK provides out of the box.

## 2. Solution

Add the **AI SDK v6** as a native BYOK runtime in the frontend. Users pick a provider, enter their API key, select a model, and get a full AI assistant with tool calling — all without installing any external CLI.

**Three runtime tiers in the AI Panel:**

| Runtime | Use case | Transport | Tools |
|---------|----------|-----------|-------|
| ACP Agents (Claude Code, Codex, OpenCode) | Agentic coding | Subprocess + stdio | MCP sidecar |
| **BYOK via AI SDK** (new) | Chat + SQL + tools | Frontend TS → HTTP | AI SDK tools → Tauri IPC |

The custom Ollama Rust code is **deleted entirely** — replaced by the AI SDK's ollama provider.

## 3. Architecture

### Runtime Selection

```
AIPanel → selectedAgentId →
  ├─ ACP agent? → existing subprocess flow (unchanged)
  └─ BYOK provider? → AI SDK streamText() in frontend
       ├─ Provider: OpenAI / Anthropic / Google / Mistral / Ollama
       ├─ Tools: queryDatabase, listTables, describeTable, etc.
       └─ Stream response → AIPanel chat UI
```

### Data Flow (BYOK path)

```
1. User types message in AIPanel
2. byokStore builds messages array (system prompt + conversation history)
3. ai/service.ts calls streamText() with:
   - provider + model (from byokStore)
   - messages (conversation history)
   - tools (queryDatabase, listTables, describeTable, etc.)
   - system prompt (with schema context from aiContextService)
4. AI SDK sends HTTP request to provider API
5. Model streams response:
   a. Text chunks → rendered in chat UI
   b. Tool calls → executed via Tauri invoke() → results fed back to model
   c. Model incorporates tool results → continues streaming
6. Final response displayed in AIPanel
```

### API Key Management

- Keys stored in existing vault/keychain system (`vaultStorage.ts` → Tauri secure storage)
- Retrieved via Tauri IPC at session start, held in memory only
- Never persisted in localStorage or plaintext
- Each provider has its own key entry

## 4. Folder Structure

```
src/
  ai/                          # Self-contained AI SDK module
    providers/                 # Provider factory + configs
      index.ts                 # createProvider(config) registry
      openai.ts                # OpenAI provider setup
      anthropic.ts             # Anthropic provider setup
      google.ts                # Google (Gemini) provider setup
      mistral.ts               # Mistral provider setup
      ollama.ts                # Ollama local provider setup
    tools/                     # AI SDK tool definitions
      index.ts                 # All tools exported
      queryDatabase.ts         # Execute SQL via Tauri IPC
      listTables.ts            # List tables in schema
      describeTable.ts         # Get column metadata
      getQueryHistory.ts       # Recent queries for context
      getCurrentContext.ts     # Active connection + editor state
    service.ts                 # streamChat() — manages conversation + tool loop
    types.ts                   # ProviderConfig, BYOKModel, ChatMessage types
    constants.ts               # System prompts, max history, tool descriptions
  stores/
    byokStore.ts               # BYOK state: provider, model, apiKey ref, history
  components/AI/
    ProviderSettings.tsx        # Provider/key/model picker (replaces OllamaSettings)
```

## 5. Providers

| Provider | Package | Key required | Notes |
|----------|---------|-------------|-------|
| OpenAI | `@ai-sdk/openai` | Yes | GPT-4o, GPT-4-turbo, o1, etc. |
| Anthropic | `@ai-sdk/anthropic` | Yes | Claude Sonnet, Opus, Haiku |
| Google | `@ai-sdk/google` | Yes | Gemini Pro, Flash |
| Mistral | `@ai-sdk/mistral` | Yes | Mistral Large, Medium, Small |
| Ollama | `ai-sdk-ollama` | No | Local models, localhost:11434 |

Each provider file exports a factory function:

```typescript
// ai/providers/openai.ts
import { createOpenAI } from "@ai-sdk/openai";

export function createOpenAIProvider(apiKey: string) {
  return createOpenAI({ apiKey });
}
```

The registry (`ai/providers/index.ts`) maps provider IDs to factories:

```typescript
export function createProvider(id: ProviderId, apiKey: string) {
  switch (id) {
    case "openai": return createOpenAIProvider(apiKey);
    case "anthropic": return createAnthropicProvider(apiKey);
    // ...
  }
}
```

## 6. Tools

Tools are AI SDK `tool()` definitions that call existing Tauri IPC commands. No new Rust backend code needed.

```typescript
// ai/tools/queryDatabase.ts
import { tool } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";

export const queryDatabase = tool({
  description: "Execute a SQL query against the active database connection",
  parameters: z.object({
    sql: z.string().describe("The SQL query to execute"),
  }),
  execute: async ({ sql }) => {
    const result = await invoke("query", { connectionId, sql });
    return result;
  },
});
```

**Tool list:**

| Tool | What it does | Tauri command |
|------|-------------|---------------|
| `queryDatabase` | Run SQL, return rows | `query` / streaming query |
| `listTables` | List tables/views in current schema | Introspection commands |
| `describeTable` | Get column names, types, PKs, FKs | Introspection commands |
| `getQueryHistory` | Last N queries for context | Read from history store |
| `getCurrentContext` | Active connection, schema, editor SQL | Read from app stores |

## 7. Service (ai/service.ts)

Core function that manages the conversation loop:

```typescript
export async function streamChat(options: {
  provider: LanguageModel;
  messages: CoreMessage[];
  tools: Record<string, Tool>;
  systemPrompt: string;
  onChunk: (text: string) => void;
  onToolCall: (name: string, args: unknown) => void;
  onFinish: (result: StreamTextResult) => void;
}) {
  const result = streamText({
    model: options.provider,
    system: options.systemPrompt,
    messages: options.messages,
    tools: options.tools,
    maxSteps: 5, // allow up to 5 tool-call rounds
    onChunk: ({ chunk }) => { ... },
    onFinish: (result) => { ... },
  });

  // Stream text to UI
  for await (const part of result.textStream) {
    options.onChunk(part);
  }
}
```

Key behaviors:
- `maxSteps: 5` — model can call tools up to 5 times in a single turn
- System prompt includes schema context (tables, columns) from `aiContextService`
- Conversation history capped at 30 messages (configurable)
- Self-correction: if a tool call (queryDatabase) returns an error, the error is fed back to the model automatically via the tool result

## 8. Store (stores/byokStore.ts)

```typescript
interface BYOKState {
  providerId: ProviderId | null;     // "openai" | "anthropic" | "google" | "mistral" | "ollama"
  modelId: string | null;            // "gpt-4o" | "claude-sonnet-4" | etc.
  messages: CoreMessage[];           // Conversation history
  isStreaming: boolean;
  availableModels: ModelInfo[];      // Fetched from provider

  // Actions
  setProvider: (id: ProviderId) => void;
  setModel: (id: string) => void;
  sendMessage: (content: string, context: AIContext) => Promise<void>;
  clearHistory: () => void;
}
```

API keys are NOT stored in the Zustand store — they're retrieved from the vault on demand and passed directly to the provider factory.

## 9. AI Panel Integration

The existing `AIPanel.tsx` routes based on agent type:

```typescript
// Pseudocode for the routing logic
if (isAcpAgent(selectedAgentId)) {
  // Existing ACP subprocess flow — unchanged
} else if (isBYOKProvider(selectedAgentId)) {
  // New: AI SDK path
  // Uses byokStore.sendMessage() → ai/service.ts → streamText()
}
```

The chat UI stays the same — text chunks stream in, SQL code blocks get QueryBlock treatment (run button, auto-correction).

**ProviderSettings.tsx** replaces `OllamaSettings.tsx`:
- Provider dropdown (OpenAI, Anthropic, Google, Mistral, Ollama)
- API key input (hidden, saved to vault on blur)
- Model selector (populated after key is validated)
- Test connection button
- For Ollama: no key needed, just model selection

## 10. Code Removed (Ollama cleanup)

Completely deleted — not deprecated:

| File | What |
|------|------|
| `src-tauri/src/acp/ollama.rs` | OllamaClient, chat_stream(), HTTP logic |
| `src-tauri/src/acp/manager.rs` → OllamaManager | Session tracking, prepare_prompt(), history |
| `src-tauri/src/acp/discovery.rs` → Ollama functions | discover_ollama_agent(), ollama_agent_unavailable(), ollama_package_info() |
| `src-tauri/src/acp/commands.rs` → Ollama routing | send_ollama_prompt(), Ollama branches in all commands |
| `src/components/AI/OllamaSettings.tsx` | Ollama connection UI |
| Ollama constants | OLLAMA_AGENT_ID, OLLAMA_DEFAULT_URL |

## 11. Dependencies

**New packages:**
- `@ai-sdk/openai` — OpenAI provider
- `@ai-sdk/anthropic` — Anthropic provider
- `@ai-sdk/google` — Google provider
- `@ai-sdk/mistral` — Mistral provider
- `ai-sdk-ollama` — Ollama community provider (v3+ for AI SDK v6)
- `zod` — Tool parameter schemas (may already be installed)

**Already installed:**
- `ai@^6.0.59` — AI SDK core (in package.json, currently unused)

## 12. Migration Path

1. Build the `src/ai/` module and `byokStore` first
2. Wire into AIPanel alongside existing ACP + Ollama paths
3. Test all providers work with tool calling
4. Delete Ollama Rust code and OllamaSettings
5. Update agent selector to show BYOK providers instead of "Ollama (Local)"

## 13. What Stays Unchanged

- ACP agents (Claude Code, Codex, OpenCode) — completely untouched
- MCP sidecar — stays for ACP agents
- AIPanel chat UI — same component, new data source
- Self-correcting AI — works naturally via AI SDK tool result errors
- Agent install dialog — still shows ACP agent install for CLI agents
