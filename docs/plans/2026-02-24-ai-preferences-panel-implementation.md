# AI Preferences Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move AI runtime settings into Preferences dialog with a compact model/agent picker in the AI panel header.

**Architecture:** Add "AI" tab to PreferencesDialog with runtime selector (ACP/BYOK), provider config, and behavior toggles. Replace inline ProviderSettings in AI panel with a compact indicator. Extend byokStore with new persisted fields for runtimeMode and behavior settings.

**Tech Stack:** React 19, Zustand (persist middleware), shadcn/ui (RadioGroup, Select, Switch, Input, Label), Tabler Icons

---

### Task 1: Extend Store — Add runtimeMode and Behavior Settings

**Files:**
- Modify: `src/stores/preferencesStore.ts:4-7` (add "ai" to PreferenceCategory)
- Modify: `src/stores/byokStore.ts:18-44,174-181` (add persisted fields + actions)

**Step 1: Add "ai" to PreferenceCategory union**

In `src/stores/preferencesStore.ts`, change:

```typescript
export type PreferenceCategory =
  | "general"
  | "shortcuts"
  | "ai"
  | "telemetry";
```

**Step 2: Add new persisted fields and actions to byokStore**

In `src/stores/byokStore.ts`, add to the `BYOKState` interface:

```typescript
interface BYOKState {
  // Persisted
  providerId: ProviderId | null;
  modelId: string | null;
  runtimeMode: "acp" | "byok";
  maxToolSteps: number;
  autoExecuteQueries: boolean;
  includeSchemaContext: boolean;

  // ... existing runtime fields ...

  // Actions (add these)
  setRuntimeMode: (mode: "acp" | "byok") => void;
  setMaxToolSteps: (steps: number) => void;
  setAutoExecuteQueries: (enabled: boolean) => void;
  setIncludeSchemaContext: (enabled: boolean) => void;
  // ... existing actions ...
}
```

Add defaults and setters in the store body:

```typescript
// After modelId: null,
runtimeMode: "acp",
maxToolSteps: 5,
autoExecuteQueries: true,
includeSchemaContext: true,

setRuntimeMode: (mode) => set({ runtimeMode: mode }),
setMaxToolSteps: (steps) => set({ maxToolSteps: Math.min(Math.max(steps, 1), 10) }),
setAutoExecuteQueries: (enabled) => set({ autoExecuteQueries: enabled }),
setIncludeSchemaContext: (enabled) => set({ includeSchemaContext: enabled }),
```

Update `partialize` to persist the new fields:

```typescript
partialize: (state) => ({
  providerId: state.providerId,
  modelId: state.modelId,
  runtimeMode: state.runtimeMode,
  maxToolSteps: state.maxToolSteps,
  autoExecuteQueries: state.autoExecuteQueries,
  includeSchemaContext: state.includeSchemaContext,
}),
```

**Step 3: Verify**

Run: `pnpm typecheck 2>&1 | grep -E "(byokStore|preferencesStore)" || echo "No errors"`

**Step 4: Commit**

```bash
git add src/stores/byokStore.ts src/stores/preferencesStore.ts
git commit -m "feat(ai): add runtimeMode and behavior settings to byokStore"
```

---

### Task 2: Wire Behavior Settings into AI SDK Pipeline

**Files:**
- Modify: `src/ai/tools/index.ts:28-38` (conditional tool registration)
- Modify: `src/ai/service.ts:10,33` (dynamic maxToolSteps)
- Modify: `src/stores/byokStore.ts:107-108` (pass settings through)

**Step 1: Accept `autoExecuteQueries` in createTools**

In `src/ai/tools/index.ts`, change `createTools` signature and body:

```typescript
export function createTools(ctx: ToolContext, options?: { autoExecuteQueries?: boolean }): ToolSet {
  const tools: ToolSet = {
    listTables: createListTablesTool(ctx.connectionId),
    describeTable: createDescribeTableTool(ctx.connectionId),
    getCurrentContext: createGetCurrentContextTool(ctx.getEditorContext),
    listConnections: createListConnectionsTool(),
    getQueryHistory: createGetQueryHistoryTool(),
  };

  if (options?.autoExecuteQueries !== false) {
    tools.queryDatabase = createQueryDatabaseTool(ctx.connectionId);
    tools.getExecutionPlan = createGetExecutionPlanTool(ctx.connectionId);
  }

  return tools;
}
```

**Step 2: Accept `maxToolSteps` in streamChat**

In `src/ai/service.ts`, change the options type and usage:

```typescript
export async function streamChat(options: {
  model: LanguageModel;
  systemPrompt: string;
  messages: ModelMessage[];
  tools: ToolSet;
  callbacks: StreamCallbacks;
  abortSignal?: AbortSignal;
  maxToolSteps?: number;
}): Promise<void> {
```

Replace `stopWhen: stepCountIs(MAX_TOOL_STEPS),` with:

```typescript
stopWhen: stepCountIs(options.maxToolSteps ?? MAX_TOOL_STEPS),
```

**Step 3: Pass settings from byokStore.sendMessage**

In `src/stores/byokStore.ts`, update the `sendMessage` method to read behavior settings and pass them:

```typescript
sendMessage: async (content, toolContext, schemaContext, callbacks) => {
  const { session, messages, isStreaming, autoExecuteQueries, includeSchemaContext, maxToolSteps } = get();
  if (!session || isStreaming) return;

  // ... existing message setup ...

  const tools = createTools(toolContext, { autoExecuteQueries });
  const systemPrompt = buildSystemPrompt(
    includeSchemaContext ? schemaContext : { databaseType: schemaContext?.databaseType },
  );

  // ... existing fullText setup ...

  await streamChat({
    model: session.provider,
    systemPrompt,
    messages: updatedMessages,
    tools,
    abortSignal: abortController.signal,
    maxToolSteps,
    callbacks: {
      // ... existing callbacks unchanged ...
    },
  });
},
```

**Step 4: Verify**

Run: `pnpm typecheck 2>&1 | grep -E "(tools/index|service|byokStore)" || echo "No errors"`

**Step 5: Commit**

```bash
git add src/ai/tools/index.ts src/ai/service.ts src/stores/byokStore.ts
git commit -m "feat(ai): wire behavior settings into tool registration and streaming"
```

---

### Task 3: Add "AI" Sidebar Entry and Lazy-Load Panel

**Files:**
- Modify: `src/components/Preferences/PreferencesSidebar.tsx:12-28` (add AI category)
- Modify: `src/components/Preferences/PreferencesDialog.tsx:4-5,34-54` (add lazy import + case)
- Create: `src/components/Preferences/panels/AIPreferencesPanel.tsx` (placeholder)

**Step 1: Create placeholder panel**

Create `src/components/Preferences/panels/AIPreferencesPanel.tsx`:

```typescript
import { Label } from "@/components/ui/label";

export default function AIPreferencesPanel() {
  return (
    <div className="max-w-3xl space-y-6 max-h-[calc(100vh-32px)] overflow-y-scroll -mx-4 px-4">
      <div className="sticky top-0 bg-background z-10 pb-2">
        <h2 className="text-base font-semibold">AI Settings</h2>
        <p className="text-xs text-muted-foreground">
          Configure AI runtime, providers, and behavior
        </p>
      </div>
      <div className="space-y-6">
        <Label className="text-sm text-muted-foreground">Coming soon...</Label>
      </div>
    </div>
  );
}
```

**Step 2: Add "AI" entry to sidebar**

In `src/components/Preferences/PreferencesSidebar.tsx`, add `IconSparkles` to imports:

```typescript
import {
  IconSettings,
  IconKeyboard,
  IconSparkles,
  IconActivity,
} from "@tabler/icons-react";
```

Add the AI category to the `categories` array (insert before telemetry):

```typescript
const categories = [
  { id: "general" as PreferenceCategory, label: "General", icon: IconSettings },
  { id: "shortcuts" as PreferenceCategory, label: "Keyboard Shortcuts", icon: IconKeyboard },
  { id: "ai" as PreferenceCategory, label: "AI", icon: IconSparkles },
  { id: "telemetry" as PreferenceCategory, label: "Telemetry & Reporting", icon: IconActivity },
];
```

**Step 3: Add lazy-loaded case to PreferencesDialog**

In `src/components/Preferences/PreferencesDialog.tsx`, add lazy import:

```typescript
const AIPreferencesPanel = lazy(() => import("./panels/AIPreferencesPanel"));
```

Add case in `renderPanel`:

```typescript
case "ai":
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <AIPreferencesPanel />
    </Suspense>
  );
```

**Step 4: Verify**

Run: `pnpm typecheck 2>&1 | grep -E "(Preferences|preferencesStore)" || echo "No errors"`

**Step 5: Commit**

```bash
git add src/components/Preferences/panels/AIPreferencesPanel.tsx \
  src/components/Preferences/PreferencesSidebar.tsx \
  src/components/Preferences/PreferencesDialog.tsx \
  src/stores/preferencesStore.ts
git commit -m "feat(preferences): add AI tab with placeholder panel"
```

---

### Task 4: Build AIPreferencesPanel — Runtime Selector + BYOK Config

**Files:**
- Modify: `src/components/Preferences/panels/AIPreferencesPanel.tsx` (replace placeholder)

**Step 1: Implement the full panel**

Replace the placeholder with the full implementation. The panel has these sections:

1. **Runtime Mode** — RadioGroup: "Agent (ACP)" | "BYOK (Bring Your Own Key)"
2. **ACP Section** (when `runtimeMode === "acp"`) — Agent picker (reuse data from `useAcpStore`), install button
3. **BYOK Section** (when `runtimeMode === "byok"`) — Provider dropdown, API key input, model dropdown, connection status
4. **Behavior** (shared) — Max tool steps, auto-execute queries switch, include schema context switch

Key patterns to follow from GeneralPanel:
- Outer: `<div className="max-w-3xl space-y-6 max-h-[calc(100vh-32px)] overflow-y-scroll -mx-4 px-4">`
- Sticky header: `<div className="sticky top-0 bg-background z-10 pb-2">`
- Section labels: `<Label className="text-base">`
- Cards: `<div className="flex items-center justify-between py-3 border rounded-xl px-4">`
- Sub-labels: `<Label className="text-xs font-medium">`
- Descriptions: `<p className="text-xs text-muted-foreground">`
- Section separator: `<div className="space-y-3 pt-4 border-t">`

Store imports needed:
- `useByokStore` — for BYOK provider/model/behavior state
- `useAcpStore` — for ACP agent list/selection
- `PROVIDER_CONFIGS` from `@/ai/providers`

Local state (not persisted):
- `apiKey: string` — API key input (same as current ProviderSettings)
- `showKey: boolean` — password visibility toggle

Auto-connect logic: use a `useEffect` that calls `initSession(apiKey)` when `providerId`, `modelId`, and `apiKey` (if required) are all set. Debounce the API key input by 500ms before triggering.

The ACP section shows:
- Installed agents as a RadioGroup (selecting one calls `selectAgent`)
- Available-to-install agents as disabled items with "Install" button
- Each agent shows its name and a green checkmark if selected

**Step 2: Verify**

Run: `pnpm typecheck 2>&1 | grep "AIPreferencesPanel" || echo "No errors"`
Run: `pnpm lint 2>&1 | grep "AIPreferencesPanel" || echo "No errors"`

**Step 3: Commit**

```bash
git add src/components/Preferences/panels/AIPreferencesPanel.tsx
git commit -m "feat(preferences): implement AI settings panel with runtime, provider, and behavior config"
```

---

### Task 5: Build CompactModelPicker for AI Panel Header

**Files:**
- Create: `src/components/AI/CompactModelPicker.tsx`

**Step 1: Implement the compact picker**

This component renders differently based on runtime mode:

**BYOK mode + session active:**
- Small dropdown button showing model name (e.g. "GPT-4o")
- Clicking opens a Select dropdown of models for the current provider
- Selecting a model calls `setModel(id)` + `initSession(apiKey)` to reinit

**BYOK mode + no session:**
- Text link: "Configure AI..." that opens Preferences > AI tab
- Uses `usePreferencesStore().openPreferences("ai")`

**ACP mode:**
- Shows current agent logo + name as a small pill
- Clicking opens Preferences > AI tab

Component sketch:

```typescript
import { useByokStore } from "@/stores/byokStore";
import { useAcpStore } from "@/stores/acpStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { PROVIDER_CONFIGS } from "@/ai/providers";
// ... UI imports ...

export function CompactModelPicker() {
  const runtimeMode = useByokStore((s) => s.runtimeMode);
  const providerId = useByokStore((s) => s.providerId);
  const modelId = useByokStore((s) => s.modelId);
  const session = useByokStore((s) => s.session);
  const setModel = useByokStore((s) => s.setModel);
  const selectedAgentId = useAcpStore((s) => s.selectedAgentId);
  const availableAgents = useAcpStore((s) => s.availableAgents);
  const openPreferences = usePreferencesStore((s) => s.openPreferences);

  if (runtimeMode === "acp") {
    // ACP: show agent name pill, click opens preferences
    const agent = availableAgents.find((a) => a.id === selectedAgentId);
    return (
      <button onClick={() => openPreferences("ai")} className="...">
        {agent?.name ?? "Select agent..."}
      </button>
    );
  }

  // BYOK: show model dropdown or configure link
  if (!session || !providerId) {
    return (
      <button onClick={() => openPreferences("ai")} className="...">
        Configure AI...
      </button>
    );
  }

  const config = PROVIDER_CONFIGS[providerId];
  return (
    <Select value={modelId ?? ""} onValueChange={setModel}>
      {/* compact trigger + model options */}
    </Select>
  );
}
```

Style: match the existing `AgentSelector` sizing — `h-6`, `text-[11px]`, ghost variant.

**Step 2: Verify**

Run: `pnpm typecheck 2>&1 | grep "CompactModelPicker" || echo "No errors"`

**Step 3: Commit**

```bash
git add src/components/AI/CompactModelPicker.tsx
git commit -m "feat(ai): add CompactModelPicker for AI panel header"
```

---

### Task 6: Replace Inline ProviderSettings in AIPanel

**Files:**
- Modify: `src/components/AI/AIPanel.tsx:29,225-235,594,2082-2084`

**Step 1: Update imports**

Replace `ProviderSettings` import with `CompactModelPicker`:

```typescript
// Remove:
import { ProviderSettings } from "./ProviderSettings";
// Add:
import { CompactModelPicker } from "./CompactModelPicker";
```

**Step 2: Replace isByok derivation**

Currently `isByok` reads from `useAcpStore((s) => s.selectedAgentId) === "byok"`. Change to read from `byokStore.runtimeMode`:

```typescript
const runtimeMode = useByokStore((s) => s.runtimeMode);
const isByok = runtimeMode === "byok";
```

Remove the `selectedAgentId` selector that was only used for `isByok` (line 225). Keep any other `selectedAgentId` usage that AgentSelector needs.

**Step 3: Remove inline ProviderSettings**

Delete line 594:
```typescript
// Remove this line:
{isByok && <ProviderSettings />}
```

**Step 4: Replace AgentSelector with CompactModelPicker in footer**

At line 2082-2084, replace:

```typescript
{/* Before */}
<AgentSelector />
<ModelSelector />

{/* After */}
<CompactModelPicker />
```

Remove `AgentSelector` import if no longer used. Keep `ModelSelector` import if it's used elsewhere (check first — it may be the ACP model selector; if so, `CompactModelPicker` handles both modes now).

**Step 5: Verify**

Run: `pnpm typecheck 2>&1 | grep -E "AIPanel" || echo "No errors"`
Run: `pnpm lint 2>&1 | grep -E "AIPanel" || echo "No errors"`

**Step 6: Commit**

```bash
git add src/components/AI/AIPanel.tsx
git commit -m "feat(ai): replace inline ProviderSettings with CompactModelPicker"
```

---

### Task 7: Final Verification and Cleanup

**Files:**
- Possibly modify: `src/components/AI/ProviderSettings.tsx` (delete if unused)
- Possibly modify: `src/components/AI/index.ts` (remove ProviderSettings export)

**Step 1: Check if ProviderSettings is still imported anywhere**

Run: `grep -r "ProviderSettings" src/ --include="*.tsx" --include="*.ts"`

If only referenced in its own file and index.ts, remove the export from `src/components/AI/index.ts` and optionally delete the file (or keep for reference).

**Step 2: Check if AgentSelector is still imported in AIPanel**

If `AgentSelector` is no longer used in AIPanel.tsx, remove the import. It may still be used in the Preferences AI panel for agent selection, so don't delete the component itself.

**Step 3: Run full verification**

```bash
pnpm typecheck 2>&1 | grep -E "src/(ai/|stores/byok|components/AI/|components/Preferences/)" || echo "No errors"
pnpm lint 2>&1 | grep -E "src/(ai/|stores/byok|components/AI/|components/Preferences/)" || echo "No errors"
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "refactor(ai): remove unused ProviderSettings and clean up imports"
```
