# DevDB AI Sidecar

This is the AI assistant sidecar for DevDB Studio. It runs as a separate process and provides AI-powered database querying capabilities using the Vercel AI SDK.

## Architecture

The sidecar is a Bun HTTP server that:

1. Receives chat requests from the Tauri application
2. Uses AI SDK to communicate with various AI providers (OpenAI, Anthropic, Google, Ollama)
3. Provides tools for the AI to interact with the database
4. Streams responses back to the frontend

## Development

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0.0
- Node.js >= 18 (for development tooling)

### Setup

```bash
cd src-tauri/sidecar-ai
bun install
```

### Running Locally

```bash
# Start the server on default port (3456)
bun run index.ts

# Or specify a custom port
PORT=8080 bun run index.ts
```

### Testing

```bash
# Health check
curl http://localhost:3456/health

# Test chat endpoint (requires API key)
curl -X POST http://localhost:3456/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "List all tables"}],
    "provider": "openai",
    "model": "gpt-4",
    "apiKey": "your-api-key",
    "connectionId": "conn-id"
  }'
```

## Building

The sidecar is compiled into standalone executables for each platform:

```bash
# Build for current platform
pnpm build:ai-sidecar

# Build for all platforms (macOS, Linux, Windows)
pnpm build:ai-sidecar:all
```

Compiled binaries are placed in `src-tauri/sidecars/` and bundled with the Tauri app.

## Supported Providers

- **OpenAI**: GPT-4, GPT-4 Turbo, GPT-3.5 Turbo
- **Anthropic**: Claude 3 Opus, Sonnet, Haiku
- **Google**: Gemini Pro, Gemini Pro Vision
- **Ollama**: Local models (Llama2, Mistral, etc.)

## Tools

The AI has access to the following database tools:

### Core Tools

- `list_tables` - Get all tables in a schema
- `get_table_structure` - Get column definitions and constraints
- `get_sample_data` - Fetch sample rows from a table
- `execute_readonly_query` - Run SELECT queries safely

### Extended Tools

- `get_indexes` - View table indexes
- `get_triggers` - List triggers
- `get_foreign_keys` - Show relationships
- `get_table_statistics` - Row counts and sizes

### Full Suite

- `get_views` - List database views
- `get_functions` - Show stored procedures/functions
- `list_schemas` - Get all schemas
- `get_object_definition` - Get SQL definitions

## Security

- API keys are passed via request headers, never stored on disk
- Only read-only SQL queries are allowed
- All queries are validated before execution
- CORS is restricted to `tauri://localhost`

## Troubleshooting

### Sidecar won't start

- Check if the port is already in use
- Verify Bun is installed and in PATH
- Check logs in the Tauri app console

### Connection refused

- Ensure the sidecar is running
- Check firewall settings
- Verify the port number matches

### Tool calls failing

- Verify database connection is active
- Check that connection ID is correct
- Review Tauri command permissions

## Development Notes

- The server uses Bun's native HTTP server for performance
- Streaming uses Server-Sent Events (SSE)
- Tool execution is delegated to the Tauri backend via HTTP
- All responses are JSON-formatted

## License

Same as parent project (DevDB Studio)
