# AI Runtime Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make AI integration reliable and consistent across ACP CLI agents and SDK BYOK agents, starting with high-severity defects and then introducing a shared runtime contract.

**Architecture:** Keep ACP and SDK runtimes, but enforce a normalized runtime adapter contract and shared orchestration state so UI behavior is capability-driven instead of branch-driven. Implement immediate safety/UX fixes first, then migrate to adapter-backed runtime flow.

**Tech Stack:** React 19 + TypeScript + Zustand + Tauri 2 + Rust ACP manager + AI SDK v6

---

### Task 1: Fix Send Gating And Image Handling In AIPanel

**Files:**
- Modify: `src/components/AI/AIPanel.tsx`
- Test: `src/components/AI/__tests__/AIPanel.send.test.tsx` (create)

**Step 1: Write the failing test**

```tsx
it("does not enable send for image-only input unless runtime supports image-only send", async () => {
  // render panel with pending image only and assert send behavior is consistent
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit src/components/AI/__tests__/AIPanel.send.test.tsx`
Expected: FAIL due to current `canSend` / `handleSend` mismatch.

**Step 3: Write minimal implementation**

- Align `canSend` condition with `handleSend` behavior.
- Decide one product behavior and implement consistently:
  - either allow image-only send and route images in both runtimes
  - or require non-empty text and disable send when only images exist.
- If BYOK image upload is unsupported, block image attachment in BYOK mode with explicit UI hint.

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit src/components/AI/__tests__/AIPanel.send.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/AI/AIPanel.tsx src/components/AI/__tests__/AIPanel.send.test.tsx
git commit -m "fix(ai): align send gating and image behavior across runtimes"
```

### Task 2: Add ACP Agent Stop Lifecycle (Process Cleanup)

**Files:**
- Modify: `src-tauri/src/acp/manager.rs`
- Modify: `src-tauri/src/acp/commands.rs`
- Modify: `src/services/acpService.ts`
- Modify: `src/stores/acpStore.ts`
- Test: `src/services/__tests__/acpService.test.ts`

**Step 1: Write the failing test**

```ts
it("calls acp_stop_agent when switching agents or starting a new conversation", async () => {
  // assert stop invoked for previous active instance
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit src/services/__tests__/acpService.test.ts`
Expected: FAIL because no stop API exists.

**Step 3: Write minimal implementation**

- Add Rust command `acp_stop_agent(instance_id)`:
  - remove process from map
  - send cancel if needed
  - terminate child process with timeout + kill fallback.
- Add `AcpService.stopAgent(instanceId)`.
- In `acpStore`, call stop for previous `activeInstanceId` on:
  - `selectAgent` runtime swap path
  - `newConversation`
  - session replacement paths when appropriate.

**Step 4: Run verification**

Run: `pnpm test:unit src/services/__tests__/acpService.test.ts`
Expected: PASS for new stop behavior.

Run: `cd src-tauri && cargo clippy`
Expected: No new warnings/errors.

**Step 5: Commit**

```bash
git add src-tauri/src/acp/manager.rs src-tauri/src/acp/commands.rs src/services/acpService.ts src/stores/acpStore.ts src/services/__tests__/acpService.test.ts
git commit -m "fix(acp): add explicit agent stop lifecycle and cleanup"
```

### Task 3: Align ACP Permission Gate With Security Policy

**Files:**
- Modify: `src-tauri/src/acp/manager.rs`
- Modify: `src-tauri/src/acp/commands.rs` (if policy text needs update)
- Test: `src-tauri/src/acp/manager.rs` unit tests (create module)

**Step 1: Write failing tests for permission decisions**

```rust
#[test]
fn denies_non_mcp_read_search_fetch_tools_by_default() {}

#[test]
fn allows_mcp_prefixed_tools() {}
```

**Step 2: Run tests to verify failure**

Run: `cd src-tauri && cargo test acp::manager`
Expected: FAIL before policy alignment.

**Step 3: Implement minimal policy fix**

- Deny non-MCP tools by default (or gate by explicit allowlist flag).
- Keep MCP-prefixed tool allowance.
- Ensure comments/logging reflect actual policy.

**Step 4: Re-run verification**

Run: `cd src-tauri && cargo test acp::manager && cargo clippy`
Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/acp/manager.rs src-tauri/src/acp/commands.rs
git commit -m "fix(acp): enforce permission policy consistent with system instructions"
```

### Task 4: Harden BYOK Tool Routing For Multi-Connection Context

**Files:**
- Modify: `src/ai/tools/index.ts`
- Modify: `src/ai/tools/queryDatabase.ts`
- Modify: `src/ai/tools/listTables.ts`
- Modify: `src/ai/tools/describeTable.ts`
- Modify: `src/ai/tools/getExecutionPlan.ts`
- Modify: `src/components/AI/AIPanel.tsx`
- Test: `src/ai/tools/__tests__/routing.test.ts` (create)

**Step 1: Write failing tests**

```ts
it("queryDatabase can target explicit connectionId when provided", async () => {});
it("falls back to focused connection when connectionId omitted", async () => {});
```

**Step 2: Run tests to confirm fail**

Run: `pnpm test:unit src/ai/tools/__tests__/routing.test.ts`
Expected: FAIL on current fixed-connection tool binding.

**Step 3: Implement minimal routing contract**

- Extend tool schemas with optional `connectionId`.
- Resolve `effectiveConnectionId = input.connectionId ?? defaultConnectionId`.
- Update BYOK prompt text to match actual tool parameters.
- Update AIPanel BYOK context builder to pass focused default only.

**Step 4: Re-run tests**

Run: `pnpm test:unit src/ai/tools/__tests__/routing.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/ai/tools/index.ts src/ai/tools/queryDatabase.ts src/ai/tools/listTables.ts src/ai/tools/describeTable.ts src/ai/tools/getExecutionPlan.ts src/components/AI/AIPanel.tsx src/ai/tools/__tests__/routing.test.ts
git commit -m "feat(ai-sdk): support explicit connection routing for tool calls"
```

### Task 5: Enforce Read-Only Guarantee In SDK Query Tool

**Files:**
- Modify: `src/ai/tools/queryDatabase.ts`
- Test: `src/ai/tools/__tests__/queryDatabase.readonly.test.ts` (create)

**Step 1: Write failing tests**

```ts
it("rejects INSERT/UPDATE/DELETE/DDL statements", async () => {});
it("accepts SELECT/WITH/SHOW read-only statements", async () => {});
```

**Step 2: Run tests (fail expected)**

Run: `pnpm test:unit src/ai/tools/__tests__/queryDatabase.readonly.test.ts`
Expected: FAIL before validator is added.

**Step 3: Implement minimal validator**

- Add read-only statement check before invoke.
- Return structured error when statement is not read-only.
- Keep limit enforcement logic but avoid dialect-invalid suffixing where unsupported.

**Step 4: Re-run tests**

Run: `pnpm test:unit src/ai/tools/__tests__/queryDatabase.readonly.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/ai/tools/queryDatabase.ts src/ai/tools/__tests__/queryDatabase.readonly.test.ts
git commit -m "fix(ai-sdk): enforce read-only SQL execution in queryDatabase tool"
```

### Task 6: Fix Quick Filter Runtime/Agent Validation

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`
- Modify: `src/stores/byokStore.ts` (if adding BYOK filter path)
- Test: `src/components/DataGrid/adapters/__tests__/SqlDataGrid.ai-filter.test.tsx` (create)

**Step 1: Write failing tests**

```tsx
it("does not pick uninstalled agents for ACP quick filter", async () => {});
it("disables AI filter with clear message when active runtime cannot serve it", async () => {});
```

**Step 2: Run tests (fail expected)**

Run: `pnpm test:unit src/components/DataGrid/adapters/__tests__/SqlDataGrid.ai-filter.test.tsx`
Expected: FAIL.

**Step 3: Implement fix**

- Use installed agents only.
- Respect runtime mode capability.
- Re-run warmup when selected agent changes (dependency-aware effect).

**Step 4: Re-run tests**

Run: `pnpm test:unit src/components/DataGrid/adapters/__tests__/SqlDataGrid.ai-filter.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/DataGrid/adapters/SqlDataGrid.tsx src/components/DataGrid/adapters/__tests__/SqlDataGrid.ai-filter.test.tsx src/stores/byokStore.ts
git commit -m "fix(ai-filter): validate runtime capability and installed agent selection"
```

### Task 7: Introduce Runtime Capability Contract (Adapter Foundation)

**Files:**
- Create: `src/ai/runtime/types.ts`
- Create: `src/ai/runtime/acpAdapter.ts`
- Create: `src/ai/runtime/sdkAdapter.ts`
- Modify: `src/components/AI/AIPanel.tsx`
- Modify: `src/stores/acpStore.ts`
- Modify: `src/stores/byokStore.ts`
- Test: `src/ai/runtime/__tests__/capabilities.test.ts` (create)

**Step 1: Write failing tests**

```ts
it("returns correct capability matrix for ACP and SDK runtimes", () => {});
it("UI send controls honor capability flags", () => {});
```

**Step 2: Run tests (fail expected)**

Run: `pnpm test:unit src/ai/runtime/__tests__/capabilities.test.ts`
Expected: FAIL.

**Step 3: Implement minimal adapter layer**

- Define capability and message-send contract.
- Add thin adapters around existing stores/services.
- Switch AIPanel send/input gating to capability checks.

**Step 4: Re-run tests**

Run: `pnpm test:unit src/ai/runtime/__tests__/capabilities.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/ai/runtime/types.ts src/ai/runtime/acpAdapter.ts src/ai/runtime/sdkAdapter.ts src/components/AI/AIPanel.tsx src/stores/acpStore.ts src/stores/byokStore.ts src/ai/runtime/__tests__/capabilities.test.ts
git commit -m "refactor(ai): add runtime adapter capability contract"
```

### Task 8: Verification Pass And Regression Sweep

**Files:**
- Modify: test files as needed
- Optional docs update: `docs/guides/ai-features.md`

**Step 1: Run frontend checks**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

**Step 2: Run targeted frontend tests**

Run: `pnpm test:unit`
Expected: core AI-related tests PASS (or document known unrelated failures).

**Step 3: Run backend verification**

Run: `cd src-tauri && cargo clippy`
Expected: PASS.

**Step 4: Manual QA checklist**

- ACP: switch agents repeatedly; verify no orphan process growth.
- ACP: send/cancel/send; tool call streaming and finalization remain stable.
- SDK: provider connect, send tool-using prompt, cancel, resume.
- Chat input: text-only, image-only, text+image all behave consistently.
- Quick filter: runtime-aware behavior and clear fallback messaging.

**Step 5: Commit final polish**

```bash
git add docs/guides/ai-features.md
git commit -m "docs(ai): update runtime behavior and capability notes"
```
