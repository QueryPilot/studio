### AI Assistance: opencode + OpenAI Codex CLI integration (MVP + v1)

Status: Draft (MVP scope locked)

Owners: Studio Platform

References:

- opencode site: [`https://opencode.ai/`](https://opencode.ai/)
- opencode SDK: [`https://opencode.ai/docs/sdk/`](https://opencode.ai/docs/sdk/)
- opencode Server: [`https://opencode.ai/docs/server/`](https://opencode.ai/docs/server/)
- OpenAI Codex CLI (terminal agent): [`https://github.com/openai/codex`](https://github.com/openai/codex)

---

### Goal

Bundle and sandbox two terminal agents to power our AI Chat Assistant:

- opencode CLI: Use Anthropic Claude Pro/Max subscription (priority for MVP). Later: Models.dev providers, API key path.
- OpenAI Codex CLI: Use ChatGPT subscription. Not in MVP.

All config, auth state, cache, logs live under one app-scoped home: `~/.devdb/`.

MVP: User logs into Claude via opencode, then sends a chat message from our `AI Chat Assistant` UI with streaming tokens.

Non-goals (MVP):

- API key auth, non-Anthropic providers, GitHub Copilot auth, Codex login.
- Multi-agent orchestration.
- On-device LLMs.

---

### High-level architecture

- Desktop shell: Tauri (Rust core + React/TS frontend in `src/components/ai/*`).
- Sidecars: Ship opencode and codex as sidecar binaries. Tauri manages lifecycle and env.
- Sandboxing: Run sidecars with tightly-scoped environment, ephemeral working dirs, and redirected HOME to app home.
- Auth automation: Headless/TUI automation with a PTY for `opencode auth login` to choose provider/method; open system browser for OAuth; detect success by watching the opencode config directory and process output.
- Chat transport: Prefer opencode Server/SDK HTTP+SSE if available; otherwise non-interactive CLI invocation with JSON output over stdio.
- State: All state under `~/.devdb`:
  - `~/.devdb/opencode/` (opencode configs, tokens, logs)
  - `~/.devdb/codex/` (codex configs, future)
  - `~/.devdb/logs/ai/*.log`
  - `~/.devdb/tmp/`

---

### Why opencode and codex

- opencode: Native TUI, supports Anthropic Claude Pro/Max login, MCP servers, multi-model routing. Good fit for leveraging user’s Claude subscription. Docs mention SDK/Server for programmatic control and SSE events \[opencode SDK, Server docs linked above\].
- OpenAI Codex CLI: Lightweight terminal agent with ChatGPT plan sign-in, also offers SDK-like workflows and MCP. GitHub repo documents installation and usage \[openai/codex\].

---

### Sandboxing and configuration strategy

Process model:

- Each sidecar runs as an external process with:
  - `HOME` set to `~/.devdb` (forces dot-dirs into our namespace)
  - `XDG_CONFIG_HOME` set to `~/.devdb`
  - Tool-specific overrides when available:
    - For opencode, prefer `OPENCODE_HOME`/`OPENCODE_DATA_DIR` if supported (fallback: it will use `$HOME/.opencode`; under our redirected HOME this becomes `~/.devdb/.opencode`. We then symlink `~/.devdb/opencode -> ~/.devdb/.opencode` for consistency).
    - For codex, similar pattern (`~/.devdb/.codex` symlinked to `~/.devdb/codex`).
  - `PATH` reduced to include only Tauri’s sidecar dir and system basics.
  - Working directory: `~/.devdb/tmp/<session-id>`.
  - Resource limits: low file descriptors and memory where safe; no shell injection (we never invoke via shells, always direct exec with argv).

File layout under `~/.devdb/`:

```
~/.devdb/
  opencode/            # canonical location we reference
  .opencode/           # actual tool default (symlink target)
  codex/
  .codex/
  logs/ai/
  tmp/
```

Data handling:

- No secrets are logged. Logs redact obvious tokens and cookies.
- Tauri secure store remains the source of truth for our app-level toggles. opencode/codex keep their own OAuth secrets in their dirs.

---

### Auth (Claude Pro/Max via opencode) — headless strategy

Problem: CLI’s subscription login is interactive and TUI-first; there’s no official headless API for Pro/Max auth in the CLIs today (both opencode and codex). We need a programmatic login that ends with valid credentials in `~/.devdb/opencode`.

Approaches we support (in priority order):

1. SDK/Server route (preferred):

   - Start `opencode server` as a sidecar on a random port with data dir under `~/.devdb/opencode` \[opencode Server docs\].
   - Use opencode SDK from our frontend to drive an auth flow. The SDK exposes event streams over SSE; on login start, it typically returns a URL to open in the browser and then resolves when the server receives the callback.
   - We launch a small modal that opens the returned URL in the system browser. We poll the SDK/server via SSE for `auth:success` and close the modal on success.
   - Pros: clean streaming, less brittle. Cons: dependent on server API availability.

2. PTY automation of `opencode auth login` (fallback):
   - Spawn `opencode auth login` under a PTY with env HOME=`~/.devdb`. Detect the “Select provider” screen and programmatically send keystrokes to choose “Anthropic” ➜ “Claude Pro/Max” (the default, per the screenshot).
   - The CLI typically prints a login URL or triggers system-open. We intercept the printed URL from stdout and open it via Tauri’s shell API.
   - Watch for either:
     - opencode writing credentials into `~/.devdb/.opencode/**`, or
     - a completion message on stdout.
   - Timeout and surface errors. On success, normalize directories (create `~/.devdb/opencode` symlink if needed).

We will first attempt (1). If the SDK/server lacks a programmatic login, we fall back to (2).

Security notes:

- Browser callback handling is owned by opencode; we do not intercept OAuth tokens in-app. We only watch for completion, not the token itself.
- All auth state remains under `~/.devdb`.

---

### Messaging flow (MVP)

Target path: Anthropic via opencode using user’s Claude Pro/Max subscription.

Preferred implementation (SDK/Server):

1. Start `opencode server` sidecar with config dir under `~/.devdb/opencode`.
2. From frontend, create an SDK client to the local server and open an SSE stream \[SDK docs\].
3. Create a session bound to Anthropic provider and selected model (e.g., Sonnet 4 or “Opus x Sonnet”).
4. Send user prompt; display stream tokens in `src/components/ai/ChatMessages.tsx`.
5. Close session on tab/window close.

CLI fallback (if server is not usable):

- Run a non-interactive command per message, ask for JSON output and stream stdout lines as chunks. If the CLI only supports TUI, we will still prefer the server.

Mapping to our UI:

- The current UI under `src/components/ai/*` is mock-based. We will swap the mock with a thin service:
  - `services/ai/opencodeClient.ts` (browser): constructs SDK client, exposes `login()`, `startSession(model)`, `sendMessage(content, mentions)`, `onToken(cb)`, `stop()`.
  - `src-tauri/src/ai/opencode.rs` (Rust): manages sidecar/server process lifecycle and port assignment; provides Tauri commands to start/stop server with the correct env and home.
  - `ChatAssistant.tsx`: call `opencodeClient.sendMessage()` instead of `generateMockResponse()`.

---

### Sidecar bundling

macOS packaging:

- Ship `opencode` and `codex` in `src-tauri/sidecars/`.
- `tauri.conf.json` sidecars entries:
  - `opencode` (required for MVP)
  - `codex` (present but unused for MVP)
- On launch, we always execute bundled sidecars. PATH lookup is disabled by default. For rare debugging only, opt-in via `DEVDB_AI_USE_PATH_TOOLS=1`; otherwise we error if a bundled sidecar is missing.

Binary acquisition & version pinning:

- Source of truth (pinned):
  - opencode release from `sst/opencode` \[releases: [`https://github.com/sst/opencode/releases`](https://github.com/sst/opencode/releases)\]
  - codex release from `openai/codex` \[releases: [`https://github.com/openai/codex/releases`](https://github.com/openai/codex/releases)\]
- Versions and repos are declared in `scripts/ai-sidecars.json`:
  ```json
  {
    "opencode": { "repo": "sst/opencode", "tag": "v0.11.1" },
    "codex": { "repo": "openai/codex", "tag": "0.39.0" }
  }
  ```
- Fetch script `scripts/fetch-ai-sidecars.mjs` (run by `pnpm ai:fetch` and as a pre-step in `pnpm tauri:build`):
  - Detect platform: `darwin-arm64` (primary), `darwin-x64` (fallback for older Macs).
  - Call GitHub Releases API for each `{repo, tag}` and select the asset matching platform (asset name includes `darwin` and `arm64|aarch64|apple`).
  - Download to `.cache/ai-sidecars/`, verify with `.sha256` if provided (or compute and store checksum in `manifest.json`).
  - Extract and place the binary at `src-tauri/sidecars/opencode/opencode` and `src-tauri/sidecars/codex/codex`.
  - `chmod +x` on both and write `src-tauri/sidecars/manifest.json` with `{ name, repo, tag, sha256, platform }`.
  - Supports `GITHUB_TOKEN` to avoid API rate limits in CI.
- Build integration:
  - `pnpm tauri:build` depends on `pnpm ai:fetch` (fails fast if assets missing).
  - CI caches `.cache/ai-sidecars/` keyed by `{repo, tag, platform}`.
- Policy:
  - No auto-updates at runtime. Bumps are explicit via PR changing `scripts/ai-sidecars.json`.
  - Licenses: include upstream LICENSE files in `src-tauri/sidecars/<tool>/LICENSE`.

Runtime env when spawning sidecars:

- `HOME=~/.devdb`
- `XDG_CONFIG_HOME=~/.devdb`
- `OPENCODE_HOME=~/.devdb/opencode` (if supported)
- `NO_COLOR=1`, `TERM=xterm-256color` (stable output)
- `RUST_BACKTRACE=0` (silence noisy traces)
- Working dir: `~/.devdb/tmp/<session-id>`

Developer note:

- No manual installation required. Dev and prod both use bundled sidecars. Do not install global `opencode`/`codex`. If you intentionally need to test a system install, launch Studio with `DEVDB_AI_USE_PATH_TOOLS=1`; the UI will display an explicit warning about the override.

---

### Tauri command surface (MVP)

Rust (`src-tauri`):

- `ai_opencode_start_server(): Promise<{ port: number }>`
  - Spawns sidecar `opencode server --port 0` (random), returns bound port.
- `ai_opencode_stop_server(): Promise<void>`
  - Kills process; cleans temp dir.
- `ai_opencode_login_claude(): Promise<'success' | 'cancelled'>`
  - Preferred: uses SDK route by asking server to start login; returns on success.
  - Fallback: PTY-automates `opencode auth login` and opens system browser when URL appears.

Frontend TS (`services/ai/opencodeClient.ts`):

```ts
import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@opencode/sdk";

export class OpencodeClient {
  private baseUrl?: string;
  private client?: any; // real SDK type

  async start(): Promise<void> {
    const { port } = await invoke<{ port: number }>("ai_opencode_start_server");
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.client = await createClient({ baseUrl: this.baseUrl });
  }

  async loginClaude(): Promise<boolean> {
    // Preferred: ask SDK to begin login; it returns a URL
    const { url } = await this.client.auth.begin({
      provider: "anthropic",
      method: "claude-pro",
    });
    // Open system browser and wait on SSE for completion
    const events = await this.client.event.subscribe();
    // consume events until auth:success/auth:error
    for await (const ev of events.stream) {
      if (ev.type === "auth.success") return true;
      if (ev.type === "auth.error")
        throw new Error(ev.properties?.message || "Login failed");
    }
    return false;
  }

  async sendMessage(sessionId: string, content: string) {
    return this.client.session.message({ sessionId, content });
  }
}
```

Notes:

- If SDK surface differs, adapt, but keep the same abstraction in our service.
- If server mode is unavailable, we’ll replace the class with a CLI stdio wrapper returning line-delimited JSON tokens.

---

### UI integration (MVP changes)

Files: `src/components/ai/ChatAssistant.tsx`, `ChatInput.tsx`, `ChatMessages.tsx`, and `services/ai/*`.

- Replace `generateMockResponse()` in `ChatAssistant.tsx` with a call into `OpencodeClient` that streams tokens and updates messages.
- Add a settings button click in `ChatHeader` that triggers `ai_opencode_login_claude()` when the user isn’t authenticated.
- Keep existing mentions UX; pass mentions as metadata in the prompt for now.
- Minimum state: selected model (map to Anthropic Sonnet/Opus x Sonnet), streaming flag, transcript list.

---

### Error handling & telemetry

- Explicit states: `not-installed`, `server-start-failed`, `login-required`, `auth-in-progress`, `auth-failed`, `ready`.
- Present precise errors with recover steps (install sidecars, retry login, check network).
- Telemetry events (local, anonymized): `opencode.server_started`, `opencode.login_started`, `opencode.login_succeeded|failed`, `opencode.message_started|completed|failed`.

---

### Security considerations

- All filesystem access for sidecars constrained to `~/.devdb` and project workspace.
- No sensitive data in logs. Redact obvious secrets with a simple regex before writing logs.
- Never echo user content to external logs; only within the running session.
- Network egress limited to model endpoints that opencode uses (cannot fully restrict at user-space; document this).
- Future: macOS App Sandbox/Network entitlements tightening; optional `sandbox-exec` is deprecated, so rely on Tauri’s entitlements and process policy.

---

### Rollout plan

1. Ship doc and stubs. Verify bundled sidecars exist at runtime; fail fast with actionable error if missing (no PATH fallback).
2. Implement sidecar server lifecycle in Rust. Add Tauri commands.
3. Implement SDK integration with SSE streaming.
4. Implement login modal and success detection.
5. Replace mock chat with real streaming. Gate behind feature flag `ai.opencode.enabled=true`.
6. QA against seeded DB projects and large prompts.

---

### Risks & mitigations

- SDK login API may not exist or change ➜ Fallback to PTY automation; keep an adapter layer in our service.
- File locations differ across versions ➜ Indirection via env vars and symlinks under `~/.devdb`.
- Antivirus/code signing blocks sidecars ➜ Allow PATH-based usage; document notarization.
- Streaming variability across providers ➜ Normalize to our `Message` interface and keep backpressure in the UI.

---

### MVP acceptance criteria

- From a clean machine with only a Claude Pro or Max subscription:
  - User opens Chat Assistant.
  - Clicks “Sign in to Claude” ➜ system browser opens, login completes.
  - opencode server is running under our sandbox home.
  - User can send a message and see streamed assistant output in our UI.
  - No secrets are written outside `~/.devdb`.

---

### v1 scope (post-MVP)

- Add Codex CLI for ChatGPT subscription.
- Add GitHub Copilot subscription path.
- API key auth for Anthropic/OpenAI.
- Persist sessions and prompt library under `~/.devdb/opencode`.
- MCP server registry and permissions surface.

---

### Open questions

- Exact opencode SDK login method signature and server endpoints; validate on first spike.
- Whether opencode exposes a clean JSON-over-stdio CLI for prompts if server off the table.
- Model naming between UI (`Opus x Sonnet`) and opencode identifiers; maintain a mapping.
