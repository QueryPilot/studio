# DataGrid Editing Without Primary Keys Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement strict-by-default SQL row editing for tables without primary keys using deterministic identity (PK/UNIQUE) plus explicit per-row best-effort escape hatch.

**Architecture:** Add a row-identity selection layer in SQL DataGrid, then make CRUD command creation consume identity columns instead of PK-only metadata. Keep existing SQL generation unchanged by continuing to emit map-based row match payloads, and add explicit matcher metadata for observability. Expose best-effort only through guarded context-menu actions with pre-check (`matchCount === 1`).

**Tech Stack:** React 19, TypeScript, Glide Data Grid, Zustand CRUD store, Vitest + Testing Library.

---

Execution skills to use while implementing: @test-driven-development, @verification-before-completion, @systematic-debugging.

### Task 1: Add Deterministic Row Identity Utility

**Files:**
- Create: `src/components/DataGrid/utils/rowIdentity.ts`
- Create: `src/components/DataGrid/utils/__tests__/rowIdentity.test.ts`
- Modify: `src/components/DataGrid/utils/index.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { chooseDeterministicIdentityColumns } from "../rowIdentity";

describe("chooseDeterministicIdentityColumns", () => {
  it("prefers primary keys, then unique constraints, then unique indexes", () => {
    expect(
      chooseDeterministicIdentityColumns({
        primaryKeys: ["id"],
        constraints: [{ type: "UNIQUE", columns: ["email"] }],
        indexes: [{ isUnique: true, isPartial: false, columns: ["username"] }],
      }),
    ).toEqual(["id"]);
  });

  it("returns null when no deterministic candidate exists", () => {
    expect(
      chooseDeterministicIdentityColumns({
        primaryKeys: [],
        constraints: [],
        indexes: [{ isUnique: false, isPartial: false, columns: ["name"] }],
      }),
    ).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/components/DataGrid/utils/__tests__/rowIdentity.test.ts`
Expected: FAIL with module/function not found.

**Step 3: Write minimal implementation**

```ts
export function chooseDeterministicIdentityColumns(input: {
  primaryKeys: string[];
  constraints: Array<{ type: string; columns: string[] }>;
  indexes: Array<{ isUnique: boolean; isPartial: boolean; columns: string[] }>;
}): string[] | null {
  if (input.primaryKeys.length > 0) return input.primaryKeys;

  const uq = input.constraints.find(
    (c) => c.type.toUpperCase() === "UNIQUE" && c.columns.length > 0,
  );
  if (uq) return uq.columns;

  const uidx = input.indexes.find(
    (i) => i.isUnique && !i.isPartial && i.columns.length > 0,
  );
  return uidx?.columns ?? null;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- src/components/DataGrid/utils/__tests__/rowIdentity.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/DataGrid/utils/rowIdentity.ts src/components/DataGrid/utils/__tests__/rowIdentity.test.ts src/components/DataGrid/utils/index.ts
git commit -m "feat(datagrid): add deterministic row identity selector"
```

### Task 2: Switch SQL Grid to Deterministic Identity Columns

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`
- Modify: `src/components/DataGrid/adapters/__tests__/SqlDataGrid.test.tsx`

**Step 1: Write the failing test**

```ts
it("uses unique constraint columns when table has no primary key", async () => {
  mockStructure({
    primaryKeys: [],
    constraints: [{ constraint_type: "UNIQUE", definition: "UNIQUE (email)" }],
    indexes: [],
  });

  const { getFactory } = renderSqlGridAndExposeFactory();
  expect(getFactory().primaryKeyColumns).toEqual(["email"]);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/components/DataGrid/adapters/__tests__/SqlDataGrid.test.tsx`
Expected: FAIL because current code only returns PK columns.

**Step 3: Write minimal implementation**

```ts
const { structure: tableStructure } = useTableFullStructure({
  // ...
  options: {
    includeConstraints: true,
    includeForeignKeys: true,
    includeIndexes: true,
  },
});

const deterministicIdentityColumns = useMemo(() => {
  return chooseDeterministicIdentityColumns({
    primaryKeys: tableStructure?.primaryKeys ?? [],
    constraints: parseUniqueConstraints(tableStructure?.constraints ?? []),
    indexes: (tableStructure?.indexes ?? []).map((idx) => ({
      isUnique: idx.is_unique,
      isPartial: idx.is_partial,
      columns: idx.columns,
    })),
  });
}, [tableStructure]);

const primaryKeyColumns = deterministicIdentityColumns ?? [];
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- src/components/DataGrid/adapters/__tests__/SqlDataGrid.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/DataGrid/adapters/SqlDataGrid.tsx src/components/DataGrid/adapters/__tests__/SqlDataGrid.test.tsx
git commit -m "feat(datagrid): derive SQL row identity from PK or UNIQUE"
```

### Task 3: Make CRUD Helpers Strategy-Aware (Not PK-Meta-Only)

**Files:**
- Modify: `src/components/DataGrid/utils/crudHelpers.ts`
- Create: `src/components/DataGrid/utils/__tests__/crudHelpers.rowIdentity.test.ts`

**Step 1: Write the failing test**

```ts
it("creates update command using provided identity columns when no is_pk metadata exists", () => {
  const command = createUpdateCommand(event, target, columns, {
    identityColumns: ["email"],
    matcherMode: "deterministic",
  });

  expect(command.payload.primaryKeys).toEqual({ email: "a@b.com" });
  expect(command.metadata?.tags).toContain("matcher:deterministic");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/components/DataGrid/utils/__tests__/crudHelpers.rowIdentity.test.ts`
Expected: FAIL due missing options signature/metadata.

**Step 3: Write minimal implementation**

```ts
type RowMatcherMode = "deterministic" | "best_effort";

interface RowMatcherOptions {
  identityColumns: string[];
  matcherMode: RowMatcherMode;
}

function extractRowMatcher(
  row: GridRowModel,
  columns: GridColumnV2[],
  options: RowMatcherOptions,
): Record<string, CrudPrimitive> {
  if (options.identityColumns.length === 0) {
    throw new Error("Cannot edit row: no deterministic identity columns configured");
  }
  // map column name -> row field and collect primitive values
}
```

Use this in `createUpdateCommand` and `createDeleteCommand`, and append matcher tag in metadata.

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- src/components/DataGrid/utils/__tests__/crudHelpers.rowIdentity.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/DataGrid/utils/crudHelpers.ts src/components/DataGrid/utils/__tests__/crudHelpers.rowIdentity.test.ts
git commit -m "refactor(datagrid): use configured row identity in CRUD helpers"
```

### Task 4: Add Strict Guardrails for Update/Delete UX

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`
- Modify: `src/components/DataGrid/base/BaseDataGrid.tsx`
- Modify: `src/components/DataGrid/components/GridContextMenuItems.tsx`
- Modify: `src/components/DataGrid/components/UnifiedContextMenu.tsx`
- Modify: `src/components/DataGrid/base/__tests__/BaseDataGrid.delete-rows.test.tsx`

**Step 1: Write the failing test**

```ts
it("does not stage delete when factory identity columns are empty", () => {
  const { invokeDeleteShortcut, stageCommand } = renderBaseGrid({
    commandFactory: { ...factory, primaryKeyColumns: [] },
  });

  invokeDeleteShortcut();
  expect(stageCommand).not.toHaveBeenCalled();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/components/DataGrid/base/__tests__/BaseDataGrid.delete-rows.test.tsx`
Expected: FAIL because delete currently stages unguarded.

**Step 3: Write minimal implementation**

```ts
const canMutateExistingRows = factory.primaryKeyColumns.length > 0;

if (!canMutateExistingRows) {
  toast.error("Update/Delete requires a primary or unique row identity");
  return;
}
```

Apply this guard to delete handlers and row-edit commit path, and show a status badge reason in SQL grid when identity is unavailable.

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- src/components/DataGrid/base/__tests__/BaseDataGrid.delete-rows.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/DataGrid/adapters/SqlDataGrid.tsx src/components/DataGrid/base/BaseDataGrid.tsx src/components/DataGrid/components/GridContextMenuItems.tsx src/components/DataGrid/components/UnifiedContextMenu.tsx src/components/DataGrid/base/__tests__/BaseDataGrid.delete-rows.test.tsx
git commit -m "feat(datagrid): enforce strict identity guardrails for update/delete"
```

### Task 5: Implement Per-Row Best-Effort Escape Hatch with Pre-Check

**Files:**
- Create: `src/components/DataGrid/utils/bestEffortMatcher.ts`
- Create: `src/components/DataGrid/utils/__tests__/bestEffortMatcher.test.ts`
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`
- Modify: `src/components/DataGrid/base/BaseDataGrid.tsx`
- Modify: `src/components/DataGrid/components/GridContextMenuItems.tsx`
- Modify: `src/components/DataGrid/components/UnifiedContextMenu.tsx`

**Step 1: Write the failing test**

```ts
it("allows best-effort only when match count is exactly one", async () => {
  mockProbeMatchCount(2);
  await expect(canProceedBestEffort(args)).resolves.toEqual({ ok: false, reason: "ambiguous" });

  mockProbeMatchCount(1);
  await expect(canProceedBestEffort(args)).resolves.toEqual({ ok: true });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/components/DataGrid/utils/__tests__/bestEffortMatcher.test.ts`
Expected: FAIL due missing helper.

**Step 3: Write minimal implementation**

```ts
export async function canProceedBestEffort(args: {
  adapter: DatabaseAdapter;
  target: { schema?: string; table: string };
  where: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; reason: "not_found" | "ambiguous" }> {
  const sql = args.adapter.select(args.target, { where: args.where, limit: 2 }) as string;
  const result = await args.adapter.execute(sql);
  const count = result.rows.length;
  if (count === 1) return { ok: true };
  if (count === 0) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "ambiguous" };
}
```

Then wire explicit context-menu actions (`Best-effort Edit...`, `Best-effort Delete...`) and block unless pre-check returns `ok: true`.

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- src/components/DataGrid/utils/__tests__/bestEffortMatcher.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/DataGrid/utils/bestEffortMatcher.ts src/components/DataGrid/utils/__tests__/bestEffortMatcher.test.ts src/components/DataGrid/adapters/SqlDataGrid.tsx src/components/DataGrid/base/BaseDataGrid.tsx src/components/DataGrid/components/GridContextMenuItems.tsx src/components/DataGrid/components/UnifiedContextMenu.tsx
git commit -m "feat(datagrid): add explicit best-effort row matching actions"
```

### Task 6: Keep Optimistic/Staged Indicators Safe with Identity Fallbacks

**Files:**
- Modify: `src/components/DataGrid/hooks/useOptimisticRows.ts`
- Modify: `src/components/DataGrid/hooks/features/useOptimisticRows.ts`
- Modify: `src/components/DataGrid/hooks/features/useStagedChangesIndicator.ts`
- Modify: `src/components/DataGrid/hooks/useOptimisticRows.test.ts`

**Step 1: Write the failing test**

```ts
it("does not apply best-effort staged update to wrong row when identity columns are empty", () => {
  const rows = useOptimisticRows({
    displayRows: initial,
    stagedCommands: [bestEffortUpdateCmd],
    primaryKeyColumns: [],
    // ...
  });

  expect(rows).toEqual(initial);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- src/components/DataGrid/hooks/useOptimisticRows.test.ts`
Expected: FAIL because empty-key signatures can collide.

**Step 3: Write minimal implementation**

```ts
if (primaryKeyColumns.length === 0) {
  // Skip PK-signature matching for safety.
  // Only apply tempId-linked inserted-row updates.
  return displayRowsWithInsertTempIdUpdatesOnly;
}
```

Mirror this behavior in `features/useOptimisticRows.ts` and staged indicator mapping.

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- src/components/DataGrid/hooks/useOptimisticRows.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/DataGrid/hooks/useOptimisticRows.ts src/components/DataGrid/hooks/features/useOptimisticRows.ts src/components/DataGrid/hooks/features/useStagedChangesIndicator.ts src/components/DataGrid/hooks/useOptimisticRows.test.ts
git commit -m "fix(datagrid): guard optimistic mapping when identity is unavailable"
```

### Task 7: Final Verification and Plan-Level Docs Sync

**Files:**
- Modify: `docs/plans/2026-02-26-datagrid-no-primary-key-editing-design.md` (optional: add implementation notes)

**Step 1: Run focused frontend tests added/changed**

Run:
```bash
pnpm test:unit -- src/components/DataGrid/utils/__tests__/rowIdentity.test.ts \
  src/components/DataGrid/utils/__tests__/crudHelpers.rowIdentity.test.ts \
  src/components/DataGrid/utils/__tests__/bestEffortMatcher.test.ts \
  src/components/DataGrid/base/__tests__/BaseDataGrid.delete-rows.test.tsx \
  src/components/DataGrid/hooks/useOptimisticRows.test.ts \
  src/components/DataGrid/adapters/__tests__/SqlDataGrid.test.tsx
```

Expected: PASS.

**Step 2: Run required project verification commands**

Run:
```bash
pnpm typecheck
pnpm lint
```

Expected: both PASS.

**Step 3: If verification fails, debug before proceeding**

Use @systematic-debugging and fix regressions before final commit.

**Step 4: Commit verification-safe final state**

```bash
git add \
  src/components/DataGrid/utils/rowIdentity.ts \
  src/components/DataGrid/utils/__tests__/rowIdentity.test.ts \
  src/components/DataGrid/utils/index.ts \
  src/components/DataGrid/adapters/SqlDataGrid.tsx \
  src/components/DataGrid/adapters/__tests__/SqlDataGrid.test.tsx \
  src/components/DataGrid/utils/crudHelpers.ts \
  src/components/DataGrid/utils/__tests__/crudHelpers.rowIdentity.test.ts \
  src/components/DataGrid/base/BaseDataGrid.tsx \
  src/components/DataGrid/components/GridContextMenuItems.tsx \
  src/components/DataGrid/components/UnifiedContextMenu.tsx \
  src/components/DataGrid/base/__tests__/BaseDataGrid.delete-rows.test.tsx \
  src/components/DataGrid/utils/bestEffortMatcher.ts \
  src/components/DataGrid/utils/__tests__/bestEffortMatcher.test.ts \
  src/components/DataGrid/hooks/useOptimisticRows.ts \
  src/components/DataGrid/hooks/features/useOptimisticRows.ts \
  src/components/DataGrid/hooks/features/useStagedChangesIndicator.ts \
  src/components/DataGrid/hooks/useOptimisticRows.test.ts
git commit -m "feat(datagrid): strict and best-effort editing for tables without PK"
```

**Step 5: Record outcome in plan/design docs**

```md
- Implemented strict deterministic identity fallback (PK/UNIQUE)
- Added explicit best-effort prechecked row actions
- Verified with typecheck, lint, and targeted unit tests
```
