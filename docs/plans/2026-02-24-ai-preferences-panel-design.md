# AI Preferences Panel Design

## Goal

Move AI runtime settings from inline AI panel into the Preferences dialog. Both ACP (agent) and BYOK runtimes are configurable from a single "AI" tab. The AI panel gets a compact model/agent picker instead.

## Preferences Dialog: New "AI" Tab

Add a 4th sidebar entry:

```
General            (IconSettings)
Keyboard Shortcuts (IconKeyboard)
AI                 (IconSparkles)    ← NEW
Telemetry          (IconActivity)
```

### AIPanel Layout

**Runtime Selector** (top)
- RadioGroup: Agent (ACP) | BYOK (Bring Your Own Key)
- Persisted in shared AI preferences store

**ACP Section** (when Agent selected)
- Agent picker dropdown (installed agents)
- Install button for available agents
- MCP sidecar status indicator

**BYOK Section** (when BYOK selected)
- Provider dropdown (OpenAI, Anthropic, Google, Mistral, Ollama)
- API key input with show/hide toggle (conditional on requiresApiKey)
- Model dropdown (models for selected provider, shows name + description)
- Auto-connect: session initializes when all required fields are filled
- Green dot / "Ready" badge for connection status
- "No API key needed" helper for Ollama

**Behavior** (shared, below border-top)
- Max tool steps: number input (1-10), default 5
- Auto-execute queries: switch, default ON. When OFF, queryDatabase tool not registered.
- Include schema context: switch, default ON. When OFF, schemaJson not sent to system prompt.

All settings persisted via Zustand persist middleware.

## AI Panel: Compact Header

Replace inline `<ProviderSettings />` with a compact indicator in the AI panel header:

- **ACP mode:** Agent logo + name pill. Clicking opens Preferences > AI.
- **BYOK mode:** Model name dropdown for quick switching. "Configure..." link opens Preferences > AI when not configured.
- **Not configured:** Text link "Configure AI provider..." opens Preferences > AI tab.

## Store Changes

Extend `byokStore` persisted state:

```typescript
// New persisted fields
runtimeMode: "acp" | "byok"    // which runtime is active
maxToolSteps: number             // default 5
autoExecuteQueries: boolean      // default true
includeSchemaContext: boolean     // default true
```

These are read by:
- `createTools()` — conditionally excludes queryDatabase/getExecutionPlan when autoExecuteQueries is OFF
- `buildSystemPrompt()` — skips schemaJson when includeSchemaContext is OFF
- `streamChat()` — uses maxToolSteps for stepCountIs()

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/components/Preferences/panels/AIPanel.tsx` |
| Create | `src/components/AI/CompactModelPicker.tsx` |
| Modify | `src/components/Preferences/PreferencesSidebar.tsx` — add "AI" category |
| Modify | `src/components/Preferences/PreferencesDialog.tsx` — lazy-load AIPanel |
| Modify | `src/stores/byokStore.ts` — add runtimeMode, behavior settings to persisted state |
| Modify | `src/components/AI/AIPanel.tsx` — replace ProviderSettings with CompactModelPicker |
| Modify | `src/ai/tools/index.ts` — respect autoExecuteQueries |
| Modify | `src/ai/constants.ts` — respect includeSchemaContext |
| Modify | `src/ai/service.ts` — use maxToolSteps from store |
