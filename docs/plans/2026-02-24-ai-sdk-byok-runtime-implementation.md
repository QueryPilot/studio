# AI SDK BYOK Runtime Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the custom Ollama Rust integration with a unified BYOK AI runtime using Vercel AI SDK v6, supporting OpenAI, Anthropic, Google, Mistral, and Ollama providers with tool calling.

**Architecture:** AI SDK runs entirely in the frontend (TypeScript). `src/ai/` module contains providers, tools, and a streaming service. The `byokStore` manages state. Tools call existing Tauri IPC commands for database access. Ollama Rust code is completely deleted.

**Tech Stack:** AI SDK v6 (`ai@^6.0.59` — already installed), `zod@^4.3.6` (already installed), `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/mistral`, `ai-sdk-ollama`

**Key docs:** [Design doc](./2026-02-24-ai-sdk-byok-runtime-design.md), [Frontend patterns](../llm-context/frontend-patterns.md), [Backend patterns](../llm-context/backend-patterns.md)

---

## Phase 1: AI SDK Module Foundation

### Task 1: Install provider packages

**Files:**
- Modify: `package.json`

**Step 1: Install AI SDK provider packages**

Run:
```bash
pnpm add @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google @ai-sdk/mistral ollama-ai-provider
```

> Note: `ai` and `zod` are already installed. `ollama-ai-provider` is the maintained community Ollama provider for AI SDK.

**Step 2: Verify installation**

Run: `pnpm typecheck 2>&1 | head -5`
Expected: No new errors (pre-existing errors are fine)

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add AI SDK provider packages for BYOK runtime"
```

---

### Task 2: Create BYOK types

**Files:**
- Create: `src/ai/types.ts`

**Step 1: Create type definitions**

```typescript
// src/ai/types.ts
import type { LanguageModelV1 } from "ai";

export type ProviderId = "openai" | "anthropic" | "google" | "mistral" | "ollama";

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  models: ProviderModelInfo[];
}

export interface ProviderModelInfo {
  id: string;
  name: string;
  description: string;
}

export interface BYOKSession {
  providerId: ProviderId;
  modelId: string;
  provider: LanguageModelV1;
}

/** Matches the callback signature used by acpStore.sendMessage() */
export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onToolCall: (toolCall: { id: string; name: string; input: unknown }) => void;
  onToolResult: (toolCallId: string, result: unknown) => void;
  onFinish: () => void;
  onError: (error: string) => void;
}
```

**Step 2: Commit**

```bash
git add src/ai/types.ts
git commit -m "feat(ai): add BYOK type definitions"
```

---

### Task 3: Create system prompt constants

**Files:**
- Create: `src/ai/constants.ts`

**Step 1: Create constants file**

Reference: Current Ollama system prompt is in `src-tauri/src/acp/ollama.rs` `build_system_prompt()` (lines 203-226). Adapt to TypeScript.

```typescript
// src/ai/constants.ts

export const MAX_HISTORY_MESSAGES = 30;
export const MAX_TOOL_STEPS = 5;

export function buildSystemPrompt(context?: {
  databaseType?: string;
  schema?: string;
}): string {
  const parts = [
    "You are a database assistant in Query Pilot, a desktop database IDE.",
    "You help users write SQL queries, explain database concepts, and analyze data.",
    "When generating SQL, output it in a ```sql code block.",
    "Be concise. Prefer showing SQL over explaining it.",
  ];

  if (context?.databaseType) {
    parts.push(`The user is connected to a ${context.databaseType} database.`);
  }

  if (context?.schema) {
    parts.push("Here is the relevant database schema:");
    parts.push(context.schema);
  }

  parts.push(
    "You have access to tools for querying the database, listing tables, and describing table structure.",
    "Use these tools when the user asks about their data or schema.",
    "After running a query with the queryDatabase tool, summarize the results clearly.",
  );

  return parts.join("\n\n");
}
```

**Step 2: Commit**

```bash
git add src/ai/constants.ts
git commit -m "feat(ai): add system prompt and constants"
```

---

### Task 4: Create provider registry

**Files:**
- Create: `src/ai/providers/openai.ts`
- Create: `src/ai/providers/anthropic.ts`
- Create: `src/ai/providers/google.ts`
- Create: `src/ai/providers/mistral.ts`
- Create: `src/ai/providers/ollama.ts`
- Create: `src/ai/providers/index.ts`

**Step 1: Create individual provider files**

```typescript
// src/ai/providers/openai.ts
import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderConfig } from "../types";

export const openaiConfig: ProviderConfig = {
  id: "openai",
  name: "OpenAI",
  requiresApiKey: true,
  models: [
    { id: "gpt-4o", name: "GPT-4o", description: "Flagship multimodal model" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", description: "Fast and affordable" },
    { id: "o1", name: "o1", description: "Reasoning model" },
    { id: "o3-mini", name: "o3-mini", description: "Fast reasoning" },
  ],
};

export function createOpenAIProvider(apiKey: string) {
  return createOpenAI({ apiKey });
}
```

```typescript
// src/ai/providers/anthropic.ts
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ProviderConfig } from "../types";

export const anthropicConfig: ProviderConfig = {
  id: "anthropic",
  name: "Anthropic",
  requiresApiKey: true,
  models: [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", description: "Best for everyday tasks" },
    { id: "claude-opus-4-20250514", name: "Claude Opus 4", description: "Most capable" },
    { id: "claude-haiku-3-5-20241022", name: "Claude Haiku 3.5", description: "Fastest" },
  ],
};

export function createAnthropicProvider(apiKey: string) {
  return createAnthropic({ apiKey });
}
```

```typescript
// src/ai/providers/google.ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ProviderConfig } from "../types";

export const googleConfig: ProviderConfig = {
  id: "google",
  name: "Google",
  requiresApiKey: true,
  models: [
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", description: "Fast and capable" },
    { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite", description: "Lightweight" },
    { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", description: "Advanced reasoning" },
  ],
};

export function createGoogleProvider(apiKey: string) {
  return createGoogleGenerativeAI({ apiKey });
}
```

```typescript
// src/ai/providers/mistral.ts
import { createMistral } from "@ai-sdk/mistral";
import type { ProviderConfig } from "../types";

export const mistralConfig: ProviderConfig = {
  id: "mistral",
  name: "Mistral",
  requiresApiKey: true,
  models: [
    { id: "mistral-large-latest", name: "Mistral Large", description: "Most capable" },
    { id: "mistral-small-latest", name: "Mistral Small", description: "Fast and efficient" },
    { id: "codestral-latest", name: "Codestral", description: "Optimized for code" },
  ],
};

export function createMistralProvider(apiKey: string) {
  return createMistral({ apiKey });
}
```

```typescript
// src/ai/providers/ollama.ts
import { createOllama } from "ollama-ai-provider";
import type { ProviderConfig } from "../types";

export const ollamaConfig: ProviderConfig = {
  id: "ollama",
  name: "Ollama (Local)",
  requiresApiKey: false,
  defaultBaseUrl: "http://localhost:11434/api",
  models: [
    { id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B", description: "Recommended for coding" },
    { id: "llama3.1:8b", name: "Llama 3.1 8B", description: "General purpose" },
    { id: "deepseek-coder-v2:16b", name: "DeepSeek Coder V2", description: "Strong at code" },
  ],
};

export function createOllamaProvider(baseUrl?: string) {
  return createOllama({ baseURL: baseUrl ?? ollamaConfig.defaultBaseUrl });
}
```

**Step 2: Create the registry**

```typescript
// src/ai/providers/index.ts
import type { LanguageModelV1 } from "ai";
import type { ProviderId, ProviderConfig } from "../types";
import { openaiConfig, createOpenAIProvider } from "./openai";
import { anthropicConfig, createAnthropicProvider } from "./anthropic";
import { googleConfig, createGoogleProvider } from "./google";
import { mistralConfig, createMistralProvider } from "./mistral";
import { ollamaConfig, createOllamaProvider } from "./ollama";

export const PROVIDER_CONFIGS: Record<ProviderId, ProviderConfig> = {
  openai: openaiConfig,
  anthropic: anthropicConfig,
  google: googleConfig,
  mistral: mistralConfig,
  ollama: ollamaConfig,
};

export function createModel(
  providerId: ProviderId,
  modelId: string,
  apiKey?: string,
): LanguageModelV1 {
  switch (providerId) {
    case "openai":
      return createOpenAIProvider(apiKey!)(modelId);
    case "anthropic":
      return createAnthropicProvider(apiKey!)(modelId);
    case "google":
      return createGoogleProvider(apiKey!)(modelId);
    case "mistral":
      return createMistralProvider(apiKey!)(modelId);
    case "ollama":
      return createOllamaProvider()(modelId);
  }
}

export { openaiConfig, anthropicConfig, googleConfig, mistralConfig, ollamaConfig };
```

**Step 3: Verify types compile**

Run: `pnpm typecheck 2>&1 | grep "src/ai/" | head -10`
Expected: No errors in `src/ai/` files

**Step 4: Commit**

```bash
git add src/ai/providers/
git commit -m "feat(ai): add provider registry for OpenAI, Anthropic, Google, Mistral, Ollama"
```

---

### Task 5: Create AI SDK tools

**Files:**
- Create: `src/ai/tools/queryDatabase.ts`
- Create: `src/ai/tools/listTables.ts`
- Create: `src/ai/tools/describeTable.ts`
- Create: `src/ai/tools/getCurrentContext.ts`
- Create: `src/ai/tools/index.ts`

**Step 1: Create queryDatabase tool**

Reference: `BackendAPI.query()` in `src/services/backend.ts:482-495` uses `invoke("query", { connId, sql, timeoutSecs })`.

```typescript
// src/ai/tools/queryDatabase.ts
import { tool } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";

export function createQueryDatabaseTool(connectionId: string) {
  return tool({
    description:
      "Execute a read-only SQL query against the connected database. Returns column names and rows. Use this to answer questions about the user's data.",
    parameters: z.object({
      sql: z.string().describe("The SQL SELECT query to execute"),
    }),
    execute: async ({ sql }) => {
      try {
        const result = await invoke<{
          columns: { name: string }[];
          rows: unknown[][];
        }>("query", { connId: connectionId, sql, timeoutSecs: 30 });

        const columns = result.columns.map((c) => c.name);
        const preview = result.rows.slice(0, 50);
        return {
          success: true,
          columns,
          rowCount: result.rows.length,
          rows: preview,
          truncated: result.rows.length > 50,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
```

**Step 2: Create listTables tool**

```typescript
// src/ai/tools/listTables.ts
import { tool } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";

export function createListTablesTool(connectionId: string) {
  return tool({
    description:
      "List all tables and views in the current database schema. Use this to understand what data is available.",
    parameters: z.object({
      schema: z
        .string()
        .optional()
        .describe("Schema name to list tables from. Omit for default schema."),
    }),
    execute: async ({ schema }) => {
      try {
        const sql = schema
          ? `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = '${schema}' ORDER BY table_name`
          : `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog') ORDER BY table_name`;

        const result = await invoke<{
          columns: { name: string }[];
          rows: unknown[][];
        }>("query", { connId: connectionId, sql, timeoutSecs: 10 });

        return {
          success: true,
          tables: result.rows.map((r) => ({
            name: r[0] as string,
            type: r[1] as string,
          })),
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
```

**Step 3: Create describeTable tool**

```typescript
// src/ai/tools/describeTable.ts
import { tool } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";

export function createDescribeTableTool(connectionId: string) {
  return tool({
    description:
      "Get the column names, data types, and constraints for a specific table. Use this before writing queries to ensure correct column names.",
    parameters: z.object({
      table: z.string().describe("Table name to describe"),
      schema: z
        .string()
        .optional()
        .describe("Schema name. Omit for default schema."),
    }),
    execute: async ({ table, schema }) => {
      try {
        const qualifiedTable = schema ? `${schema}.${table}` : table;
        const sql = `SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_name = '${table}'${schema ? ` AND table_schema = '${schema}'` : ""}
          ORDER BY ordinal_position`;

        const result = await invoke<{
          columns: { name: string }[];
          rows: unknown[][];
        }>("query", { connId: connectionId, sql, timeoutSecs: 10 });

        return {
          success: true,
          table: qualifiedTable,
          columns: result.rows.map((r) => ({
            name: r[0] as string,
            type: r[1] as string,
            nullable: r[2] === "YES",
            default: r[3] as string | null,
          })),
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
```

**Step 4: Create getCurrentContext tool**

```typescript
// src/ai/tools/getCurrentContext.ts
import { tool } from "ai";
import { z } from "zod";

export function createGetCurrentContextTool(getContext: () => {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  editorContent: string | null;
}) {
  return tool({
    description:
      "Get the current editor context: active connection, database, schema, and SQL in the editor.",
    parameters: z.object({}),
    execute: async () => {
      return getContext();
    },
  });
}
```

**Step 5: Create tools index**

```typescript
// src/ai/tools/index.ts
import type { CoreTool } from "ai";
import { createQueryDatabaseTool } from "./queryDatabase";
import { createListTablesTool } from "./listTables";
import { createDescribeTableTool } from "./describeTable";
import { createGetCurrentContextTool } from "./getCurrentContext";

export interface ToolContext {
  connectionId: string;
  getEditorContext: () => {
    connectionId: string | null;
    database: string | null;
    schema: string | null;
    editorContent: string | null;
  };
}

export function createTools(ctx: ToolContext): Record<string, CoreTool> {
  return {
    queryDatabase: createQueryDatabaseTool(ctx.connectionId),
    listTables: createListTablesTool(ctx.connectionId),
    describeTable: createDescribeTableTool(ctx.connectionId),
    getCurrentContext: createGetCurrentContextTool(ctx.getEditorContext),
  };
}
```

**Step 6: Verify types compile**

Run: `pnpm typecheck 2>&1 | grep "src/ai/" | head -10`
Expected: No errors in `src/ai/` files

**Step 7: Commit**

```bash
git add src/ai/tools/
git commit -m "feat(ai): add AI SDK tools for database access via Tauri IPC"
```

---

### Task 6: Create streaming service

**Files:**
- Create: `src/ai/service.ts`

**Step 1: Create the service**

Reference: `acpStore.sendMessage()` at `src/stores/acpStore.ts:677-788` — BYOK must match the streaming callback pattern.

```typescript
// src/ai/service.ts
import { streamText, type CoreMessage, type LanguageModelV1, type CoreTool } from "ai";
import type { StreamCallbacks } from "./types";
import { MAX_TOOL_STEPS } from "./constants";

export async function streamChat(options: {
  model: LanguageModelV1;
  systemPrompt: string;
  messages: CoreMessage[];
  tools: Record<string, CoreTool>;
  callbacks: StreamCallbacks;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const { model, systemPrompt, messages, tools, callbacks, abortSignal } =
    options;

  let fullText = "";

  try {
    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools,
      maxSteps: MAX_TOOL_STEPS,
      abortSignal,
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta") {
          fullText += chunk.textDelta;
          callbacks.onChunk(chunk.textDelta);
        } else if (chunk.type === "tool-call") {
          callbacks.onToolCall({
            id: chunk.toolCallId,
            name: chunk.toolName,
            input: chunk.args,
          });
        }
      },
      onStepFinish: ({ toolResults }) => {
        if (toolResults) {
          for (const tr of toolResults) {
            callbacks.onToolResult(tr.toolCallId, tr.result);
          }
        }
      },
      onError: ({ error }) => {
        callbacks.onError(
          error instanceof Error ? error.message : String(error),
        );
      },
    });

    // Consume the stream to completion
    await result.text;

    callbacks.onFinish();
  } catch (err) {
    if (abortSignal?.aborted) return fullText;
    callbacks.onError(err instanceof Error ? err.message : String(err));
  }

  return fullText;
}
```

**Step 2: Verify types compile**

Run: `pnpm typecheck 2>&1 | grep "src/ai/service" | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/ai/service.ts
git commit -m "feat(ai): add streaming chat service with tool orchestration"
```

---

## Phase 2: Store & UI

### Task 7: Create byokStore

**Files:**
- Create: `src/stores/byokStore.ts`

**Step 1: Create the store**

Reference: `acpStore.ts` persist pattern at lines 992-998. Vault pattern at `src/services/vaultStorage.ts`.

```typescript
// src/stores/byokStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CoreMessage } from "ai";
import type { ProviderId, BYOKSession } from "@/ai/types";
import { PROVIDER_CONFIGS, createModel } from "@/ai/providers";
import { buildSystemPrompt } from "@/ai/constants";
import { streamChat } from "@/ai/service";
import { createTools, type ToolContext } from "@/ai/tools";
import type { StreamCallbacks } from "@/ai/types";

interface BYOKState {
  // Persisted
  providerId: ProviderId | null;
  modelId: string | null;

  // Runtime
  messages: CoreMessage[];
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  session: BYOKSession | null;
  abortController: AbortController | null;

  // Actions
  setProvider: (id: ProviderId) => void;
  setModel: (id: string) => void;
  initSession: (apiKey?: string) => void;
  sendMessage: (
    content: string,
    toolContext: ToolContext,
    schemaContext?: { databaseType?: string; schema?: string },
    callbacks?: Partial<StreamCallbacks>,
  ) => Promise<void>;
  cancelGeneration: () => void;
  clearHistory: () => void;
}

export const useByokStore = create<BYOKState>()(
  persist(
    (set, get) => ({
      // Persisted state
      providerId: null,
      modelId: null,

      // Runtime state
      messages: [],
      isStreaming: false,
      streamingContent: "",
      error: null,
      session: null,
      abortController: null,

      setProvider: (id) => {
        const config = PROVIDER_CONFIGS[id];
        const defaultModel = config.models[0]?.id ?? null;
        set({ providerId: id, modelId: defaultModel, session: null, messages: [] });
      },

      setModel: (id) => {
        set({ modelId: id, session: null });
      },

      initSession: (apiKey) => {
        const { providerId, modelId } = get();
        if (!providerId || !modelId) return;

        const config = PROVIDER_CONFIGS[providerId];
        if (config.requiresApiKey && !apiKey) return;

        const model = createModel(providerId, modelId, apiKey);
        set({
          session: { providerId, modelId, provider: model },
          error: null,
        });
      },

      sendMessage: async (content, toolContext, schemaContext, callbacks) => {
        const { session, messages } = get();
        if (!session) return;

        const userMessage: CoreMessage = { role: "user", content };
        const updatedMessages = [...messages, userMessage];

        const abortController = new AbortController();
        set({
          messages: updatedMessages,
          isStreaming: true,
          streamingContent: "",
          error: null,
          abortController,
        });

        const tools = createTools(toolContext);
        const systemPrompt = buildSystemPrompt(schemaContext);

        let fullText = "";

        await streamChat({
          model: session.provider,
          systemPrompt,
          messages: updatedMessages,
          tools,
          abortSignal: abortController.signal,
          callbacks: {
            onChunk: (text) => {
              fullText += text;
              set({ streamingContent: fullText });
              callbacks?.onChunk?.(text);
            },
            onToolCall: (tc) => {
              callbacks?.onToolCall?.(tc);
            },
            onToolResult: (id, result) => {
              callbacks?.onToolResult?.(id, result);
            },
            onFinish: () => {
              const assistantMessage: CoreMessage = {
                role: "assistant",
                content: fullText,
              };
              set((state) => ({
                messages: [...state.messages, assistantMessage],
                isStreaming: false,
                streamingContent: "",
                abortController: null,
              }));
              callbacks?.onFinish?.();
            },
            onError: (error) => {
              set({ isStreaming: false, error, abortController: null });
              callbacks?.onError?.(error);
            },
          },
        });
      },

      cancelGeneration: () => {
        const { abortController } = get();
        abortController?.abort();
        set({ isStreaming: false, abortController: null });
      },

      clearHistory: () => {
        set({ messages: [], streamingContent: "", error: null });
      },
    }),
    {
      name: "byok-preferences",
      partialize: (state) => ({
        providerId: state.providerId,
        modelId: state.modelId,
      }),
    },
  ),
);
```

**Step 2: Verify types compile**

Run: `pnpm typecheck 2>&1 | grep "byokStore" | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/stores/byokStore.ts
git commit -m "feat(ai): add byokStore for BYOK state management"
```

---

### Task 8: Create ProviderSettings component

**Files:**
- Create: `src/components/AI/ProviderSettings.tsx`

**Step 1: Create the component**

Reference: `OllamaSettings.tsx` for visual style, `AgentSelector.tsx` for dropdown patterns.

```typescript
// src/components/AI/ProviderSettings.tsx
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconCheck, IconEye, IconEyeOff, IconLoader2 } from "@tabler/icons-react";
import { useByokStore } from "@/stores/byokStore";
import { PROVIDER_CONFIGS } from "@/ai/providers";
import type { ProviderId } from "@/ai/types";

export function ProviderSettings() {
  const { providerId, modelId, setProvider, setModel, initSession, session } =
    useByokStore();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

  const config = providerId ? PROVIDER_CONFIGS[providerId] : null;

  const handleTestConnection = useCallback(async () => {
    if (!providerId || !modelId) return;
    if (config?.requiresApiKey && !apiKey) return;

    setTesting(true);
    setTestResult(null);

    try {
      initSession(apiKey || undefined);
      setTestResult("success");
    } catch {
      setTestResult("error");
    } finally {
      setTesting(false);
    }
  }, [providerId, modelId, apiKey, config, initSession]);

  return (
    <div className="space-y-3 px-3 py-2">
      {/* Provider Selector */}
      <div className="space-y-1">
        <Label className="text-xs font-medium">Provider</Label>
        <Select
          value={providerId ?? ""}
          onValueChange={(v) => { setProvider(v as ProviderId); }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select a provider..." />
          </SelectTrigger>
          <SelectContent>
            {Object.values(PROVIDER_CONFIGS).map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* API Key (if required) */}
      {config?.requiresApiKey && (
        <div className="space-y-1">
          <Label className="text-xs font-medium">API Key</Label>
          <div className="flex gap-1">
            <Input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestResult(null);
              }}
              placeholder={`Enter ${config.name} API key...`}
              className="h-8 text-xs font-mono"
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => { setShowKey(!showKey); }}
            >
              {showKey ? (
                <IconEyeOff className="h-3.5 w-3.5" />
              ) : (
                <IconEye className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Model Selector */}
      {config && (
        <div className="space-y-1">
          <Label className="text-xs font-medium">Model</Label>
          <Select
            value={modelId ?? ""}
            onValueChange={setModel}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select a model..." />
            </SelectTrigger>
            <SelectContent>
              {config.models.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  <span>{m.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    {m.description}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Test / Connect Button */}
      {config && (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={() => { void handleTestConnection(); }}
          disabled={testing || (config.requiresApiKey && !apiKey)}
        >
          {testing ? (
            <IconLoader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : testResult === "success" ? (
            <IconCheck className="h-3.5 w-3.5 mr-1.5 text-green-500" />
          ) : null}
          {session ? "Connected" : "Connect"}
        </Button>
      )}

      {/* No API key note for Ollama */}
      {config && !config.requiresApiKey && (
        <p className="text-[11px] text-muted-foreground">
          No API key needed — runs locally on your machine.
        </p>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/AI/ProviderSettings.tsx
git commit -m "feat(ai): add ProviderSettings component for BYOK configuration"
```

---

## Phase 3: Wire Into AI Panel

### Task 9: Integrate BYOK into AIPanel and AgentSelector

This is the largest integration task. It connects the BYOK runtime to the existing AI Panel by adding a "BYOK" agent entry to the agent selector and routing messages through the AI SDK when a BYOK provider is active.

**Files:**
- Modify: `src/components/AI/AIPanel.tsx`
- Modify: `src/components/AI/AgentSelector.tsx`
- Modify: `src/components/AI/index.ts`

**Step 1: Add BYOK to AgentSelector**

In `src/components/AI/AgentSelector.tsx`, add a "Bring Your Own Key" section in the dropdown after the "Available" section. This shows BYOK as a special option separate from ACP agents.

Look at the existing agent grouping (lines 98-111) and dropdown rendering (lines 156-244). Add a third group:

```typescript
// After the "Available" section in the dropdown, add:
<DropdownMenuSeparator />
<DropdownMenuGroup>
  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Bring Your Own Key</DropdownMenuLabel>
  <DropdownMenuItem onClick={() => handleSelectByok()}>
    <IconKey className="h-4 w-4" />
    <span>BYOK Provider</span>
    {selectedAgentId === "byok" && <IconCheck className="h-3.5 w-3.5 ml-auto" />}
  </DropdownMenuItem>
</DropdownMenuGroup>
```

Add `IconKey` to the tabler imports. Add `handleSelectByok` that calls `selectAgent("byok")`.

**Step 2: Route BYOK in AIPanel**

In `src/components/AI/AIPanel.tsx`:

1. Import `ProviderSettings` and `useByokStore`
2. Replace the `OllamaSettings` import and render with `ProviderSettings` when `selectedAgentId === "byok"`
3. In the message sending flow, check if BYOK is active and route through `byokStore.sendMessage()` instead of `AcpService.sendPrompt()`

Key integration point is `handleSend()` (line 340). When BYOK is active:

```typescript
if (selectedAgentId === "byok") {
  // Route through AI SDK
  await byokSendMessage(content, toolContext, schemaContext, {
    onChunk: (text) => appendChunk(text),
    onFinish: () => finalizeMessage(),
    onError: (err) => { /* handle error */ },
  });
} else {
  // Existing ACP flow
  await sendMessage(content, contextJson, images);
}
```

**Step 3: Update index.ts exports**

Add `ProviderSettings` to `src/components/AI/index.ts` if other components need it.

**Step 4: Verify it compiles and existing tests pass**

Run:
```bash
pnpm typecheck 2>&1 | grep "src/components/AI/" | head -10
pnpm vitest run src/components/AI/__tests__/ 2>&1
```

**Step 5: Commit**

```bash
git add src/components/AI/AIPanel.tsx src/components/AI/AgentSelector.tsx src/components/AI/index.ts
git commit -m "feat(ai): wire BYOK runtime into AIPanel and AgentSelector"
```

---

## Phase 4: Delete Ollama Code

### Task 10: Remove Ollama Rust backend code

**Files:**
- Delete: `src-tauri/src/acp/ollama.rs`
- Modify: `src-tauri/src/acp/mod.rs` — remove `pub mod ollama;`
- Modify: `src-tauri/src/acp/manager.rs` — delete `OllamaSession`, `OllamaManager`, and its `impl` blocks (lines 628-771)
- Modify: `src-tauri/src/acp/discovery.rs` — delete `OLLAMA_DEFAULT_URL`, `OLLAMA_AGENT_ID`, `ollama_package_info()`, `discover_ollama_agent()`, `ollama_agent_unavailable()` (lines 408-469)
- Modify: `src-tauri/src/acp/commands.rs` — remove all `ollama_mgr: State<'_, Arc<OllamaManager>>` params, remove all `if ollama_mgr.has_instance(...)` branches, delete `send_ollama_prompt()` function, remove Ollama imports
- Modify: `src-tauri/src/main.rs` — remove `OllamaManager` instantiation and `.manage(ollama_manager)` call

**Step 1: Delete ollama.rs**

```bash
rm src-tauri/src/acp/ollama.rs
```

**Step 2: Remove module declaration from mod.rs**

Remove `pub mod ollama;` and the Ollama comment from `src-tauri/src/acp/mod.rs`.

**Step 3: Clean up manager.rs**

Delete the entire OllamaManager section (lines 628-771 approximately). Keep AcpManager untouched.

**Step 4: Clean up discovery.rs**

Delete lines 408-469 (Ollama section: constants, `ollama_package_info()`, `discover_ollama_agent()`, `ollama_agent_unavailable()`). Also delete the Ollama comment in `fetch_agent_models()`.

**Step 5: Clean up commands.rs**

This is the largest change. For each command function:
- Remove the `ollama_mgr` parameter
- Remove the `if ollama_mgr.has_instance(...)` branch
- Remove `OLLAMA_AGENT_ID`, `OLLAMA_DEFAULT_URL` imports
- Remove `use super::manager::OllamaManager`
- Remove `use super::ollama`
- Delete the entire `send_ollama_prompt()` function
- Remove the Ollama block in `acp_list_agents()`

**Step 6: Clean up main.rs**

Remove `OllamaManager` instantiation and `.manage()` call.

**Step 7: Verify backend compiles**

Run: `cd src-tauri && cargo clippy 2>&1 | head -20`
Expected: Compiles with only pre-existing warnings (no Ollama-related errors)

**Step 8: Commit**

```bash
git add -A src-tauri/
git commit -m "refactor: remove Ollama Rust backend code (replaced by AI SDK)"
```

---

### Task 11: Remove Ollama frontend code

**Files:**
- Delete: `src/components/AI/OllamaSettings.tsx`
- Modify: `src/components/AI/AIPanel.tsx` — remove `OllamaSettings` import and render
- Modify: `src/components/AI/AgentSelector.tsx` — remove Ollama from `AGENT_LOGOS`
- Modify: `src/components/AI/AgentInstallDialog.tsx` — remove `isOllama` variable and Ollama post-install section

**Step 1: Delete OllamaSettings**

```bash
rm src/components/AI/OllamaSettings.tsx
```

**Step 2: Clean up AIPanel.tsx**

Remove the `import { OllamaSettings }` line and the `<OllamaSettings />` render.

**Step 3: Clean up AgentSelector.tsx**

Remove the `"ollama"` entry from `AGENT_LOGOS`.

**Step 4: Clean up AgentInstallDialog.tsx**

Remove the `isOllama` variable and the entire `{isOllama && (...)}` JSX block.

**Step 5: Verify frontend compiles and tests pass**

Run:
```bash
pnpm typecheck 2>&1 | grep -E "(OllamaSettings|ollama)" | head -10
pnpm vitest run src/components/AI/__tests__/ 2>&1
pnpm lint 2>&1 | grep -E "(OllamaSettings|ollama)" | head -10
```

Expected: No references to OllamaSettings, no test failures related to Ollama

**Step 6: Commit**

```bash
git add -A src/components/AI/
git commit -m "refactor: remove Ollama frontend code (replaced by AI SDK ProviderSettings)"
```

---

## Phase 5: Verification

### Task 12: Full verification

**Step 1: Run all frontend tests**

Run: `pnpm test:unit 2>&1 | tail -20`
Expected: All existing tests pass

**Step 2: Run frontend typecheck**

Run: `pnpm typecheck 2>&1 | head -10`
Expected: No new errors (only pre-existing ones)

**Step 3: Run frontend lint**

Run: `pnpm lint 2>&1 | grep "src/ai/" | head -10`
Expected: No errors in `src/ai/` directory

**Step 4: Run backend clippy**

Run: `cd src-tauri && cargo clippy 2>&1 | head -20`
Expected: Compiles with only pre-existing warnings

**Step 5: Test manual flow (dev server)**

Run: `make dev` and verify:
1. AI Panel opens
2. Agent selector shows "Bring Your Own Key" section
3. Selecting BYOK shows ProviderSettings
4. Can select provider, enter key, select model
5. Can send message and receive streaming response
6. Tool calls work (ask about tables or run a query)
7. ACP agents still work as before
