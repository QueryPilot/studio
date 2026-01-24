# AI Sidecar

## Overview

The AI sidecar is a separate TypeScript/Bun executable that handles LLM inference:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Tauri     │     │  AI Sidecar │     │   LLM API   │
│   (Rust)    │────▶│   (Bun)     │────▶│ OpenAI/etc  │
│             │     │  Port 47856 │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   ▲
       │                   │
       └───── Spawns ──────┘
       └───── Injects API keys from OS keychain
```

## Architecture

- Compiled via `bun build --compile`
- Output: `src-tauri/sidecars/ai-server-{platform}`
- Port: 47856 (hardcoded)
- Started by Tauri's sidecar API on app startup

## Startup Flow

1. Rust `AIManager` spawns sidecar
2. Loads API keys from OS keychain (keyring crate)
3. HTTP POST to `/config` endpoint to inject keys
4. Frontend communicates directly with sidecar via HTTP

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| GET | `/status` | Configured providers list |
| GET | `/providers` | Available models per provider |
| POST | `/config` | Set API keys |
| POST | `/chat` | LLM inference (Vercel AI SDK) |

## Frontend Integration

**Service**: `src/services/aiService.ts`

**Store**: `useAIChatStore` (persisted provider/model selection)

**Streaming**: `useChat` hook from `@ai-sdk/react`

## Development

```bash
# Run sidecar in dev mode (Bun on port 3001)
make dev-sidecar
# or
make ds
```

## Building

```bash
# Build for current platform
make build-ai

# Build for all platforms
make build-ai-all
```

The build script (`scripts/build-ai-sidecar.sh`) detects OS/arch and produces platform-specific binaries.

## Adding a Route

1. Add route in `src-tauri/sidecar-ai/index.ts`
2. Update `src/services/aiService.ts` with HTTP client method
3. Rebuild: `make build-ai`

## Key Files

| Path | Purpose |
|------|---------|
| `src-tauri/sidecar-ai/index.ts` | Sidecar entry point |
| `src/services/aiService.ts` | Frontend HTTP client |
| `src/stores/aiChatStore.ts` | Provider/model selection |
| `src-tauri/src/ai/` | Rust AIManager |
| `scripts/build-ai-sidecar.sh` | Build script |
