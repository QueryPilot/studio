import { invoke, isTauri } from "@tauri-apps/api/core";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";

const OPENCODE_CONFIG_VERSION = "2025-10-08";
const COMMAND_PLACEHOLDER_REGEX = /\$([A-Z0-9_]+)/g;

interface OpencodeConfigInitResult {
  agents_path: string;
  command_paths: string[];
  version?: string;
  updated: boolean;
}

let cachedClient: OpencodeClient | null = null;
let cachedBaseUrl: string | undefined;
let configInitPromise: Promise<OpencodeConfigInitResult | null> | null = null;
let lastConfigVersion: string | undefined;

export async function ensureOpencodeConfigs(
  force = false,
): Promise<OpencodeConfigInitResult | null> {
  if (!isTauri()) return null;
  if (!force && configInitPromise) return configInitPromise;

  const options: { version?: string; force?: boolean } = {
    version: OPENCODE_CONFIG_VERSION,
  };
  if (force) options.force = true;

  const promise = invoke<OpencodeConfigInitResult>("ai_init_opencode_configs", {
    options,
  })
    .then((result) => {
      const resolvedVersion = result.version ?? options.version;
      const versionChanged =
        typeof resolvedVersion === "string" &&
        resolvedVersion.length > 0 &&
        resolvedVersion !== lastConfigVersion;

      if (result.updated || versionChanged) {
        cachedBaseUrl = undefined;
        cachedClient = null;
      }

      if (typeof resolvedVersion === "string" && resolvedVersion.length > 0) {
        lastConfigVersion = resolvedVersion;
      }

      return result;
    })
    .catch((error) => {
      configInitPromise = null;
      throw error;
    });

  configInitPromise = promise;
  return promise;
}

export async function ensureOpencodeServer(): Promise<string> {
  const viteUrl = (import.meta as unknown as { env?: Record<string, string> })
    .env?.VITE_OPENCODE_URL;

  if (!isTauri()) {
    if (!cachedBaseUrl) {
      cachedBaseUrl = viteUrl || "http://127.0.0.1:4096";
      console.warn(
        `[AI] Tauri not detected. Using OpenCode at ${cachedBaseUrl}`,
      );
    }
    return cachedBaseUrl;
  }

  await ensureOpencodeConfigs();

  if (cachedBaseUrl) return cachedBaseUrl;

  try {
    console.log("AI:", "ensureOpencodeServer:start");
    const res = await invoke<{ url: string }>("ai_opencode_start_server");
    cachedBaseUrl = res.url;
    console.log("AI:", "ensureOpencodeServer:ready", cachedBaseUrl);
    return cachedBaseUrl;
  } catch (e) {
    if (viteUrl) {
      cachedBaseUrl = viteUrl;
      console.warn(
        `[AI] Failed to start sidecar. Falling back to VITE_OPENCODE_URL=${cachedBaseUrl}`,
        e,
      );
      return cachedBaseUrl;
    }
    cachedBaseUrl = "http://127.0.0.1:4096";
    console.warn(
      `[AI] Failed to start sidecar. Falling back to ${cachedBaseUrl}. Make sure 'opencode serve' is running.`,
      e,
    );
    return cachedBaseUrl;
  }
}

export async function getOpencodeClient(): Promise<OpencodeClient> {
  if (cachedClient) return cachedClient;
  const baseUrl = await ensureOpencodeServer();

  const client = createOpencodeClient({ baseUrl, responseStyle: "data" });
  cachedClient = client;
  return cachedClient;
}

export async function listAICommands(): Promise<AICommandDefinition[]> {
  if (!isTauri()) return [];
  try {
    const client = await getOpencodeClient();
    const response: unknown = await client.command.list({});
    const items = Array.isArray(response) ? response : readArray(response);
    return items
      .map((item) => {
        const record = asRecord(item);
        const name = readString(record, "name");
        const template = readString(record, "template") ?? "";
        if (!name || !template) return null;
        return {
          name,
          template,
          description: readString(record, "description"),
          agent: readString(record, "agent"),
          model: readString(record, "model"),
          variables: extractCommandVariables(template),
        } satisfies AICommandDefinition;
      })
      .filter((value): value is AICommandDefinition => Boolean(value));
  } catch (error) {
    console.error("Failed to list AI commands:", error);
    return [];
  }
}

export async function listAIAgents(): Promise<AIAgent[]> {
  if (!isTauri()) return [];
  try {
    const client = await getOpencodeClient();
    const response: unknown = await client.app.agents({});
    const items = Array.isArray(response) ? response : readArray(response);
    return items
      .map((item) => {
        const record = asRecord(item);
        const name = readString(record, "name");
        if (!name) return null;
        const mode = readString(record, "mode");
        const description = readString(record, "description");
        const builtIn = Boolean(record["builtIn"]);
        const modelRecord = asRecord(record["model"]);
        const providerID = readString(modelRecord, "providerID");
        const modelID = readString(modelRecord, "modelID");
        const toolsRecord = asRecord(record["tools"]);
        const tools = Object.entries(toolsRecord)
          .filter(([, enabled]) => Boolean(enabled))
          .map(([toolName]) => toolName);
        const promptPath = readString(record, "prompt");
        return {
          id: name,
          name,
          description,
          mode,
          model:
            providerID && modelID
              ? `${providerID}/${modelID}`
              : modelID ?? undefined,
          tools,
          prompt: promptPath,
          builtIn,
        } satisfies AIAgent;
      })
      .filter((value): value is AIAgent => value !== null);
  } catch (error) {
    console.error("Failed to list AI agents:", error);
    return [];
  }
}

export function renderCommandTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(COMMAND_PLACEHOLDER_REGEX, (_match, key) => {
    const replacement = values[key as string];
    return typeof replacement === "string" && replacement.length > 0
      ? replacement
      : `$${key}`;
  });
}

export async function runAICommand(
  sessionId: string,
  command: AICommandDefinition,
  args: Record<string, string>,
  agentOverride?: string,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("AI commands require the desktop app environment");
  }

  const client = await getOpencodeClient();

  const payload: {
    command: string;
    arguments: string;
    agent?: string;
    model?: string;
  } = {
    command: command.name,
    arguments: JSON.stringify(args ?? {}),
  };

  if (command.agent) payload.agent = command.agent;
  else if (agentOverride) payload.agent = agentOverride;
  if (command.model) payload.model = command.model;

  try {
    await client.session.command({
      path: { id: sessionId },
      body: payload,
    });
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error(`Failed to execute command ${command.name}`);
  }
}

export async function setAnthropicOAuth(
  access: string,
  refresh: string,
  expires: number,
): Promise<void> {
  const client = await getOpencodeClient();
  const auth = (
    client as {
      auth?: {
        set?: (args: {
          path: { id: string };
          body: unknown;
        }) => Promise<unknown>;
      };
    }
  ).auth;
  if (!auth?.set) throw new Error("opencode client missing auth.set");

  await auth.set({
    path: { id: "anthropic" },
    body: { type: "oauth", access, refresh, expires },
  });
}

// ---------- OpenAuth client-side flow (ported from attached index.mjs) ----------
// WebCrypto-based PKCE generator (avoids Node util/crypto dependencies)
function base64UrlEncode(bytes: Uint8Array): string {
  // Browser-safe base64url
  const binary = Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join("");
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

async function generatePKCEWeb(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const verifier = base64UrlEncode(random); // 43 chars
  const challengeBytes = await sha256(verifier);
  const challenge = base64UrlEncode(challengeBytes);
  return { verifier, challenge };
}

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

export async function beginAnthropicOAuth(
  mode: "oauth" | "console" = "oauth",
): Promise<{ url: string; verifier: string }> {
  const pkce = await generatePKCEWeb();
  const base =
    mode === "console" ? "https://console.anthropic.com" : "https://claude.ai";
  const url = new URL(`${base}/oauth/authorize`);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", ANTHROPIC_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "redirect_uri",
    "https://console.anthropic.com/oauth/code/callback",
  );
  url.searchParams.set(
    "scope",
    "org:create_api_key user:profile user:inference",
  );
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", pkce.verifier);
  return { url: url.toString(), verifier: pkce.verifier };
}

export async function exchangeAnthropicCode(
  code: string,
  verifier: string,
): Promise<{ access: string; refresh: string; expires: number }> {
  if (isTauri()) {
    try {
      const result = await invoke<{
        access: string;
        refresh: string;
        expires: number;
      }>("ai_anthropic_exchange_code", { code, verifier });
      return result;
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
  // Fallback (non-Tauri) – will likely fail due to CORS in browser
  const splits = code.split("#");
  const rawCode = splits[0] || code;
  const state = splits[1] || "";

  const res = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: rawCode,
      state: state,
      grant_type: "authorization_code",
      client_id: ANTHROPIC_CLIENT_ID,
      redirect_uri: "https://console.anthropic.com/oauth/code/callback",
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `token exchange failed: ${res.status} ${res.statusText} ${text}`,
    );
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

export async function verifyOpencodeAuth(): Promise<boolean> {
  const out = await invoke<{ stdout: string; success: boolean }>(
    "ai_opencode_auth_ls",
  );
  return out.success && /Anthropic\s+oauth/i.test(out.stdout);
}

export interface AIProvider {
  id: string;
  name: string;
  models: Model[];
  default_model?: string;
}

export interface Model {
  id: string;
  name?: string;
}

export interface AICommandDefinition {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  template: string;
  variables: string[];
}

export interface AIAgent {
  id: string;
  name: string;
  description?: string;
  mode?: string;
  model?: string;
  tools?: string[];
  prompt?: string;
  builtIn?: boolean;
}

export interface SendChatOptions {
  model?: string;
  agent?: string;
  onStream?: (chunk: string) => void;
  onComplete?: () => void;
}
// Small type-safe helpers for unknown JSON
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readString(obj: unknown, key: string): string | undefined {
  const r = asRecord(obj);
  const v = r[key];
  return typeof v === "string" ? v : undefined;
}

function readArray(obj: unknown, key?: string): unknown[] {
  const target: unknown = key ? asRecord(obj)[key] : obj;
  return Array.isArray(target) ? (target as unknown[]) : [];
}

function extractCommandVariables(template: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  const regex = new RegExp(COMMAND_PLACEHOLDER_REGEX);
  while ((match = regex.exec(template)) !== null) {
    const key = match[1]?.trim();
    if (key) found.add(key);
  }
  return Array.from(found);
}

// Define our own Session interface
export interface AISession {
  id: string;
  title: string;
  messages?: ChatMessage[];
  createdAt?: string;
  updatedAt?: string;
}

// Session Management
export async function createSession(title?: string): Promise<AISession | null> {
  try {
    const client = await getOpencodeClient();
    const session = await client.session.create({
      body: {
        title: title || `DevDB Session ${new Date().toLocaleString()}`,
      },
    });

    const s = asRecord(session);
    const id = readString(s, "id");
    if (id) {
      return {
        id,
        title: readString(s, "title") || title || "New Session",
        createdAt: readString(s, "createdAt"),
        updatedAt: readString(s, "updatedAt"),
      };
    }
    return null;
  } catch (error) {
    console.error("Error creating session:", error);
    return null;
  }
}

export async function listSessions(): Promise<AISession[]> {
  try {
    const client = await getOpencodeClient();
    const result: unknown = await client.session.list();
    const items = Array.isArray(result)
      ? result
      : readArray(asRecord(result), "data");
    return items
      .map((it) => {
        const r = asRecord(it);
        return {
          id: readString(r, "id") ?? "",
          title: readString(r, "title") || "Untitled Session",
          createdAt: readString(r, "createdAt"),
          updatedAt: readString(r, "updatedAt"),
        } as AISession;
      })
      .filter((s) => s.id);
  } catch (error) {
    console.error("Error listing sessions:", error);
    return [];
  }
}

export async function getSession(sessionId: string): Promise<AISession | null> {
  const client = await getOpencodeClient();
  const result: unknown = await client.session.get({
    path: { id: sessionId },
  });

  const container = asRecord(result);
  const v = Object.keys(container).length
    ? container
    : asRecord(container["data"]);
  const id = readString(v, "id");
  if (id) {
    return {
      id,
      title: readString(v, "title") || "Untitled Session",
      createdAt: readString(v, "createdAt"),
      updatedAt: readString(v, "updatedAt"),
    };
  }
  return null;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const client = await getOpencodeClient();
  await client.session.delete({
    path: { id: sessionId },
  });
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
}

// Send message with streaming support
export async function sendChatMessage(
  sessionId: string,
  message: string,
  options: SendChatOptions = {},
): Promise<void> {
  const client = await getOpencodeClient();

  const onStream = options.onStream;
  const onComplete = options.onComplete;
  const requestedModel = options.model?.trim() ?? "";
  const requestedAgent = options.agent?.trim() ?? "";

  let providerID = "opencode";
  let modelID: string | undefined;

  if (requestedModel.length > 0) {
    if (requestedModel.includes("/")) {
      const parts = requestedModel.split("/");
      providerID = parts[0] || "opencode";
      modelID = parts.slice(1).join("/") || undefined;
    } else {
      modelID = requestedModel;
    }
  }

  if (!modelID) {
    try {
      const providersRespUnknown: unknown = await client.config.providers();
      const respRec = asRecord(providersRespUnknown);
      const providersRaw = readArray(respRec, "providers");
      const defaultsRec = asRecord(respRec["default"]);
      for (const p of providersRaw) {
        const pr = asRecord(p);
        const id = readString(pr, "id");
        if (!id) continue;
        const defaultModel = readString(defaultsRec, id);
        if (defaultModel) {
          providerID = id;
          modelID = defaultModel;
          break;
        }
        if (!modelID) {
          const modelsRaw = asRecord(pr["models"]);
          const firstModel = Object.values(modelsRaw)
            .map((m) => asRecord(m))
            .map((m) => readString(m, "id") || "")
            .find((x) => x);
          if (firstModel) {
            providerID = id;
            modelID = firstModel;
          }
        }
      }
    } catch {
      // leave model unset if discovery fails; server may use defaults
    }
  }

  try {
    const streamState = { active: true };
    const stopAt = Date.now() + 60_000;
    void (async () => {
      try {
        const events = await client.event.subscribe();
        type EventStream = { stream: AsyncIterable<unknown> };
        for await (const ev of (events as EventStream).stream) {
          if (!streamState.active) break;
          const er = asRecord(ev);
          const etype = readString(er, "type") || "";
          const props = asRecord(er["properties"] ?? er["data"]);
          const sid =
            readString(props, "sessionId") ||
            readString(asRecord(props["session"]), "id") ||
            readString(props, "session_id");
          if (sid !== sessionId) {
            if (Date.now() > stopAt) break;
            continue;
          }
          const part = asRecord(props["part"]);
          const ptype = readString(part, "type");
          const ptext = readString(part, "text");
          const looksLikeDelta =
            /message/i.test(etype) && /(delta|part|chunk)/i.test(etype);
          if (
            looksLikeDelta &&
            ptype === "text" &&
            typeof ptext === "string" &&
            ptext.length > 0
          ) {
            onStream?.(ptext);
          }
          const pdone = asRecord(props)["done"];
          const done =
            typeof pdone === "boolean"
              ? pdone
              : /complete|end|finished/i.test(etype);
          if (done || Date.now() > stopAt) break;
        }
      } catch {
        // ignore SSE errors
      }
    })();

    const body: Record<string, unknown> = {
      parts: [
        {
          type: "text",
          text: message,
        },
      ],
    };
    if (modelID) {
      body["model"] = {
        providerID,
        modelID,
      };
    }
    if (requestedAgent.length > 0) {
      body["agent"] = requestedAgent;
    }

    console.log("AI: sending message", {
      preview: message.slice(0, 96),
      providerID,
      modelID,
      agent: requestedAgent || undefined,
    });

    const response: unknown = await client.session.prompt({
      path: { id: sessionId },
      body,
    });

    const whole = asRecord(response);
    const dataBlock = Object.keys(whole).length
      ? whole
      : asRecord(whole["data"]);
    const parts = readArray(dataBlock, "parts");
    for (const p of parts) {
      const pr = asRecord(p);
      if (readString(pr, "type") === "text") {
        const text = readString(pr, "text");
        if (typeof text === "string") onStream?.(text);
      }
    }
    streamState.active = false;
    onComplete?.();
  } catch (error) {
    console.error("Failed to send message:", error);
    throw error;
  }
}

// List messages in a session (lightweight mapping for UI)
export interface AIMessageLite {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
  model?: string;
}

export async function listSessionMessages(
  sessionId: string,
): Promise<AIMessageLite[]> {
  try {
    const client = await getOpencodeClient();
    const resUnknown: unknown = await client.session.messages({
      path: { id: sessionId },
    });
    const rows: unknown[] = Array.isArray(resUnknown)
      ? resUnknown
      : readArray(asRecord(resUnknown), "data");
    return rows.map((row, idx) => {
      const rr = asRecord(row);
      const info = asRecord(rr["info"]);
      const parts = readArray(rr, "parts");
      const text = parts
        .map((p) => asRecord(p))
        .filter(
          (p) =>
            readString(p, "type") === "text" &&
            typeof readString(p, "text") === "string",
        )
        .map((p) => readString(p, "text") as string)
        .join("");
      const modelRec = asRecord(info["model"]);
      const provider = readString(modelRec, "providerID");
      const modelID =
        readString(modelRec, "modelID") ?? readString(modelRec, "id");
      const model = provider && modelID ? `${provider}/${modelID}` : modelID;
      const roleRaw =
        readString(info, "role") ??
        readString(asRecord(info["author"]), "role");
      let role: "user" | "assistant" | "system" = "user";
      if (roleRaw === "assistant" || roleRaw === "system") {
        role = roleRaw;
      }
      return {
        id: readString(info, "id") ?? String(idx),
        role,
        content: text,
        createdAt:
          readString(info, "createdAt") ?? readString(info, "timestamp"),
        model,
      };
    });
  } catch (error) {
    console.error("Error listing session messages:", error);
    return [];
  }
}

export async function getAIProviders(): Promise<AIProvider[]> {
  try {
    // Fetch providers from OpenCode server
    const baseUrl = await ensureOpencodeServer();
    console.log("AI: ensureOpencodeServer", baseUrl);
    const client = await getOpencodeClient();

    const providersRespUnknown: unknown = await client.config.providers();
    const respRec = asRecord(providersRespUnknown);
    const providersRaw = readArray(respRec, "providers");
    const defaultsRec = asRecord(respRec["default"]);
    console.log(
      "AI: response",
      JSON.stringify(
        {
          providers: providersRaw.length,
          defaults: Object.keys(defaultsRec).length,
        },
        null,
        2,
      ),
    );

    if (providersRaw.length === 0) {
      console.warn("No providers in response");
      return [];
    }

    // Transform the response - the API already returns only available providers/models
    const providers: AIProvider[] = [];

    for (const p of providersRaw) {
      const pr = asRecord(p);
      const id = readString(pr, "id");
      if (!id) continue;
      const name = readString(pr, "name") || id;
      const modelsRaw = asRecord(pr["models"]);
      const models: Model[] = Object.values(modelsRaw)
        .map((m) => asRecord(m))
        .map((m) => ({
          id: readString(m, "id") || "",
          name: readString(m, "name"),
        }))
        .filter((m) => m.id);
      const defaultModel = readString(defaultsRec, id);
      providers.push({ id, name, models, default_model: defaultModel });
    }

    return providers;
  } catch (error) {
    console.error("Failed to fetch AI providers:", error);
    return [];
  }
}
