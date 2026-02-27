# AI Runtime Unification Design

## Context

Query Pilot currently has two runtime paths for AI:

- CLI Agents runtime via ACP (`acpStore` + `acpService` + `src-tauri/src/acp/*`)
- SDK Agent runtime via AI SDK v6 + provider key (`byokStore` + `src/ai/*`)

The current split works for basic chat, but there are behavior mismatches and reliability gaps across runtime selection, tool access, session lifecycle, and permissions.

## Primary Findings (from code review)

1. Image send UX is broken in chat input.
- `canSend` allows image-only messages, but `handleSend` hard-returns on empty text, so send button can be enabled while doing nothing.
- BYOK path clears images but drops them instead of sending.

2. ACP agent process lifecycle is not bounded.
- Session cancellation does not terminate the subprocess.
- Agent switches/new conversation/warmups can create additional ACP processes without an explicit stop lifecycle.

3. Security policy is inconsistent.
- ACP system prompt forbids `Read/Search/Fetch`-style non-MCP tools.
- Runtime permission gate auto-approves those same tool kinds.

4. BYOK tool routing is single-connection despite multi-connection prompts.
- Tools are bound to one focused connection at creation time.
- Prompting suggests using connection IDs across workspace, but tools do not support connection selection.

5. SQL helper tools are not dialect-safe.
- `queryDatabase` can run non-read SQL despite read-only contract.
- `listTables/describeTable` are `information_schema`-specific and can fail on SQLite/other paradigms.

6. Quick filter AI path is ACP-only and weakly validated.
- Uses ACP silent prompt regardless of runtime mode.
- Chooses from discovered agents, not installed agents.

## Goals

- Preserve dual runtimes while making behavior consistent and explicit.
- Remove high-severity UX and safety defects first.
- Introduce runtime capability contracts (not implicit assumptions).
- Ensure every runtime path has deterministic session/process lifecycle.

## Non-Goals

- Replacing ACP with SDK runtime or vice versa.
- Large UI redesign.
- Full cross-database semantic query planner in this phase.

## Approaches

### Approach A: Patch-in-place on current stores/services

Patch defects directly in `AIPanel`, `acpStore`, `acpService`, and AI tools with minimal structural change.

Pros:
- Fastest to ship immediate fixes.
- Small diff risk.

Cons:
- Runtime behavior remains duplicated and drifts over time.
- Harder to reason about capabilities and parity.

### Approach B: Add a shared runtime adapter layer (Recommended)

Introduce a `RuntimeAdapter` contract and keep ACP and BYOK as two implementations. Move shared chat control flow into one orchestrator.

Pros:
- Removes runtime branching from UI-heavy paths.
- Forces capability and error model standardization.
- Easier to test parity and evolve features.

Cons:
- Moderate refactor cost.
- Requires migration plan and compatibility scaffolding.

### Approach C: Full unification behind backend service

Move runtime orchestration fully backend-side; frontend sees one API.

Pros:
- Strong long-term architecture.

Cons:
- High scope and migration risk.
- Slower to deliver urgent fixes.

## Recommendation

Use Approach B with a phased rollout:

- Phase 0: Immediate defect fixes (input/image, permission mismatch, process cleanup, quick filter validation).
- Phase 1: Runtime adapter + shared orchestrator with feature flags.
- Phase 2: Tooling contract hardening and dialect-aware behavior.
- Phase 3: Remove legacy duplicated runtime branches.

## Target Architecture

### Runtime Adapter Contract

Create `src/ai/runtime/types.ts`:

- `init()`
- `warmup(context)`
- `sendMessage(request)`
- `cancel(sessionRef)`
- `newConversation(scope)`
- `loadSession(sessionId)`
- `listSessions(filter)`
- `getCapabilities()`

Implementations:

- `AcpRuntimeAdapter`
- `SdkRuntimeAdapter`

### Shared Orchestrator

Create `src/stores/aiRuntimeStore.ts` (or equivalent) to:

- route to selected runtime adapter
- maintain normalized message model
- enforce capability checks before send
- centralize error handling, retries, and telemetry

### Capability Matrix

Each runtime returns explicit capabilities:

- `supportsImages`
- `supportsSessionHistory`
- `supportsPlanEvents`
- `supportsToolStreaming`
- `supportsBackgroundFilters`

UI behavior is driven by capability checks, not runtime if/else.

### Session & Process Lifecycle

ACP:

- add explicit `stopAgent(instanceId)` command in Rust manager
- on agent switch/new conversation/runtime switch: cancel active prompt + stop previous process
- enforce one active process per selected runtime conversation scope

SDK:

- persist conversation sessions similarly to ACP (or explicitly mark ephemeral)
- add session metadata so UI history behavior is predictable

### Security Alignment

- Align ACP permission gate with system prompt policy.
- Non-MCP file/system tools should be denied by default (unless explicitly enabled by product decision).
- Add optional UI approval bridge for dangerous operations.

### Tooling Contract

- BYOK tools accept optional `connectionId` for multi-connection routing.
- Validate `queryDatabase` is read-only at tool boundary.
- Use dialect-aware introspection queries (or shared backend introspection command).

### Quick Filter Strategy

- If runtime is ACP and installed agent exists: use silent ACP path.
- If runtime is BYOK and capability enabled: use SDK runtime filter generation.
- Otherwise: disable AI mode with actionable UI state.

## Validation Strategy

- Unit: runtime adapters, tool routing, capability gates.
- Integration: runtime switching + send/cancel/new conversation.
- E2E/manual: image send, session history, quick filter AI, agent switches.
- Stability: process count/cleanup assertions for ACP lifecycle.

## Rollout Plan

1. Ship Phase 0 fixes under current architecture.
2. Add adapter/orchestrator behind feature flag.
3. Migrate AIPanel to orchestrator.
4. Migrate quick filter and preferences paths.
5. Remove dead branches after parity validation.

## Success Criteria

- No enabled send action that is silently ignored.
- No unbounded ACP subprocess growth from runtime switches/new conversations.
- Runtime switch preserves predictable UX and capability-specific behavior.
- BYOK and ACP both support valid multi-connection workflows (or clear, enforced limits).
- Permission behavior matches declared security policy.
