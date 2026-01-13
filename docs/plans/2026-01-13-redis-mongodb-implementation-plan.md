# Redis & MongoDB Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring Redis and MongoDB implementations to full parity with the 2026-01-12 design, aligning adapter capabilities, correctness, and UI.

**Architecture:** Fix correctness gaps first, then enforce capability-based adapters with paradigm-level IPC, then implement streaming and UI parity. Backend traits become the single source of capability truth; frontend adapters are reduced or expanded to match.

**Tech Stack:** Rust + Tauri IPC (MessagePack streaming), React 19 + TypeScript, Zustand, Tailwind, shadcn/ui.

---

### Task 1: Fix connection correctness (SRV + Redis SELECT)

**Files:**
- Modify: `src-tauri/src/adapters/mongodb/adapter.rs`
- Modify: `src-tauri/src/adapters/redis/adapter.rs`
- Test: `src-tauri/src/adapters/mongodb/adapter.rs` (inline tests)
- Test: `src-tauri/src/adapters/redis/adapter.rs` (inline tests)

**Step 1: Write failing tests**
```rust
#[test]
fn build_srv_connection_string_no_port() {
    let config = MongoConnectionConfig::srv("cluster0.mongodb.net", "mydb");
    let uri = build_connection_string(&config).unwrap();
    assert!(uri.starts_with("mongodb+srv://"));
    assert!(!uri.contains(":27017"));
}

#[tokio::test]
async fn select_db_issues_select_command() {
    let adapter = RedisAdapter::new_test().await;
    adapter.select_db(2).await.unwrap();
    let info = adapter.get_server_info(None).await.unwrap();
    assert!(info.contains("db2"));
}
```

**Step 2: Run tests to verify failure**
Run: `cd src-tauri && cargo test build_srv_connection_string_no_port select_db_issues_select_command -v`
Expected: FAIL (SRV includes port; SELECT not issued).

**Step 3: Implement minimal fixes**
- Remove port from SRV host formatting.
- Issue `SELECT` via fred before updating local state.

**Step 4: Run tests to verify pass**
Run: `cd src-tauri && cargo test build_srv_connection_string_no_port select_db_issues_select_command -v`
Expected: PASS.

**Step 5: Commit**
```bash
git add src-tauri/src/adapters/mongodb/adapter.rs src-tauri/src/adapters/redis/adapter.rs
git commit -m "fix: correct Mongo SRV and Redis select"
```

---

### Task 2: Enforce capability traits in Rust

**Files:**
- Modify: `src-tauri/src/core/capabilities.rs`
- Modify: `src-tauri/src/adapters/mongodb/adapter.rs`
- Modify: `src-tauri/src/adapters/redis/adapter.rs`
- Modify: `src-tauri/src/adapters/mod.rs`
- Test: `src-tauri/src/core/capabilities.rs` (unit tests)

**Step 1: Write failing tests**
```rust
#[test]
fn mongodb_adapter_implements_document_queryable() {
    fn assert_impl<T: DocumentQueryable>() {}
    assert_impl::<MongoDbAdapter>();
}

#[test]
fn redis_adapter_implements_keyvalue_ops() {
    fn assert_impl<T: KeyValueOperable>() {}
    assert_impl::<RedisAdapter>();
}
```

**Step 2: Run tests to verify failure**
Run: `cd src-tauri && cargo test mongodb_adapter_implements_document_queryable redis_adapter_implements_keyvalue_ops -v`
Expected: FAIL (traits not implemented).

**Step 3: Implement minimal trait impls**
- Add `impl DocumentQueryable for MongoDbAdapter` with existing methods.
- Add `impl KeyValueOperable` and `impl RichKeyValueOperable` for Redis.

**Step 4: Run tests to verify pass**
Run: `cd src-tauri && cargo test mongodb_adapter_implements_document_queryable redis_adapter_implements_keyvalue_ops -v`
Expected: PASS.

**Step 5: Commit**
```bash
git add src-tauri/src/core/capabilities.rs src-tauri/src/adapters/mongodb/adapter.rs src-tauri/src/adapters/redis/adapter.rs
 git commit -m "refactor: align adapters to capability traits"
```

---

### Task 3: Add paradigm-level IPC commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/core/manager.rs`
- Test: `src-tauri/src/commands.rs` (unit tests or integration tests)

**Step 1: Write failing tests**
```rust
#[tokio::test]
async fn document_execute_routes_to_adapter() {
    let res = document_execute("conn_id".into(), DocumentOperation::ListCollections).await;
    assert!(res.is_ok());
}
```

**Step 2: Run test to verify failure**
Run: `cd src-tauri && cargo test document_execute_routes_to_adapter -v`
Expected: FAIL (command missing).

**Step 3: Implement minimal command**
- Add `document_execute` and `keyvalue_execute` commands to call capability traits.
- Update `invoke_handler` registration.

**Step 4: Run tests to verify pass**
Run: `cd src-tauri && cargo test document_execute_routes_to_adapter -v`
Expected: PASS.

**Step 5: Commit**
```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/core/manager.rs
 git commit -m "feat: add paradigm-level document/keyvalue IPC"
```

---

### Task 4: Streaming support for Mongo find and Redis scan

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/adapters/mongodb/msgpack_converter.rs`
- Modify: `src-tauri/src/adapters/redis/msgpack_converter.rs`
- Modify: `src/services/queryStreamClient.ts` (or new KV/document stream client)
- Test: `src-tauri/src/adapters/mongodb/msgpack_converter.rs`

**Step 1: Write failing tests**
```rust
#[test]
fn mongo_msgpack_stream_roundtrip() {
    let docs = vec![doc! { "_id": 1, "name": "a" }];
    let encoded = encode_bson_vec_to_msgpack(&docs).unwrap();
    assert!(!encoded.is_empty());
}
```

**Step 2: Run tests to verify failure**
Run: `cd src-tauri && cargo test mongo_msgpack_stream_roundtrip -v`
Expected: FAIL if converter not exposed.

**Step 3: Implement minimal streaming**
- Add streamed `document_execute` and `keyvalue_execute` variants for find/scan.
- Use MessagePack chunking similar to SQL streaming.

**Step 4: Run tests to verify pass**
Run: `cd src-tauri && cargo test mongo_msgpack_stream_roundtrip -v`
Expected: PASS.

**Step 5: Commit**
```bash
git add src-tauri/src/commands.rs src-tauri/src/adapters/mongodb/msgpack_converter.rs src-tauri/src/adapters/redis/msgpack_converter.rs src/services/queryStreamClient.ts
 git commit -m "feat: stream Mongo/Redis results via MessagePack"
```

---

### Task 5: Frontend adapter alignment to capabilities

**Files:**
- Modify: `src/adapters/capabilities.ts`
- Modify: `src/adapters/mongodb/MongoDBAdapter.ts`
- Modify: `src/adapters/redis/RedisAdapter.ts`
- Modify: `src/services/backendApi.ts` (if needed)
- Test: `src/adapters/**/*.{test,spec}.{ts,tsx}`

**Step 1: Write failing tests**
```ts
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";

test("MongoDBAdapter exposes listCollections", async () => {
  const adapter = new MongoDBAdapter();
  expect(typeof adapter.listCollections).toBe("function");
});
```

**Step 2: Run tests to verify failure**
Run: `pnpm test:unit MongoDBAdapter -v`
Expected: FAIL if methods missing.

**Step 3: Implement minimal alignment**
- Update frontend adapters to use new paradigm IPC.
- Remove unsupported capability flags or implement missing methods.

**Step 4: Run tests to verify pass**
Run: `pnpm test:unit MongoDBAdapter -v`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/adapters/capabilities.ts src/adapters/mongodb/MongoDBAdapter.ts src/adapters/redis/RedisAdapter.ts
 git commit -m "refactor: align frontend adapters to capabilities"
```

---

### Task 6: Redis key browser grid + grouping

**Files:**
- Modify: `src/components/Redis/KeyBrowser.tsx`
- Modify: `src/screens/workspace/components/RedisSidebar.tsx`
- Modify: `src/stores/redisStore.ts`
- Modify: `src/components/Redis/editors/index.ts`
- Test: `src/components/Redis/**/*.{test,spec}.{ts,tsx}`

**Step 1: Write failing tests**
```tsx
import { render } from "@testing-library/react";
import { KeyBrowser } from "@/components/Redis/KeyBrowser";

test("renders key grid columns", () => {
  const { getByText } = render(<KeyBrowser />);
  expect(getByText("Key")).toBeInTheDocument();
  expect(getByText("TTL")).toBeInTheDocument();
});
```

**Step 2: Run tests to verify failure**
Run: `pnpm test:unit KeyBrowser -v`
Expected: FAIL (grid missing).

**Step 3: Implement minimal UI**
- Add grid with columns Key/Type/TTL/Size.
- Implement SCAN pagination and key grouping in sidebar.

**Step 4: Run tests to verify pass**
Run: `pnpm test:unit KeyBrowser -v`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/components/Redis/KeyBrowser.tsx src/screens/workspace/components/RedisSidebar.tsx src/stores/redisStore.ts
 git commit -m "feat: Redis key grid and grouping"
```

---

### Task 7: Mongo document editor tree + Redis ZSet/Stream editors

**Files:**
- Create: `src/components/MongoDB/DocumentEditor/TreeView.tsx`
- Create: `src/components/MongoDB/DocumentEditor/Breadcrumb.tsx`
- Modify: `src/components/MongoDB/DocumentEditor/index.tsx`
- Create: `src/components/Redis/editors/ZSetEditor.tsx`
- Create: `src/components/Redis/editors/StreamViewer.tsx`
- Modify: `src/components/Redis/editors/index.ts`
- Test: `src/components/MongoDB/**/*.{test,spec}.{ts,tsx}`

**Step 1: Write failing tests**
```tsx
import { render } from "@testing-library/react";
import { DocumentEditor } from "@/components/MongoDB/DocumentEditor";

test("shows breadcrumb path", () => {
  const { getByText } = render(<DocumentEditor value={{ a: { b: 1 } }} />);
  expect(getByText("root")).toBeInTheDocument();
});
```

**Step 2: Run tests to verify failure**
Run: `pnpm test:unit DocumentEditor -v`
Expected: FAIL.

**Step 3: Implement minimal editors**
- Add tree view + breadcrumb navigation.
- Add ZSet and Stream editors with basic read UI.

**Step 4: Run tests to verify pass**
Run: `pnpm test:unit DocumentEditor -v`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/components/MongoDB/DocumentEditor src/components/Redis/editors
 git commit -m "feat: document tree editor and Redis zset/stream"
```

---

### Task 8: Docs + validation checklist

**Files:**
- Modify: `docs/plans/2026-01-12-redis-mongodb-support-design.md`
- Modify: `README_DATABASES.md`

**Step 1: Update docs**
- Mark completed features and remaining deferred items.

**Step 2: Run doc checks**
Run: `pnpm lint` (if docs linted) or skip.

**Step 3: Commit**
```bash
git add docs/plans/2026-01-12-redis-mongodb-support-design.md README_DATABASES.md
 git commit -m "docs: update Redis/Mongo implementation status"
```

---

## Test Plan
### Objective: Verify Redis/Mongo correctness, capability alignment, and UI parity
### Prerequisites: Docker databases running or local Redis/Mongo instances
### Test Cases:
1. **Mongo SRV Connection**: Connect with `mongodb+srv://` → successful connection → verify buildInfo shows target cluster.
2. **Redis DB Select**: Switch DB to 2 → `INFO keyspace` shows db2 → key operations work in db2.
3. **Document Execute**: Run `document_execute` find → stream results → grid renders.
4. **KeyValue Execute**: Run `keyvalue_execute` scan → stream results → grid renders.
5. **Redis Key Grouping**: Sidebar shows grouped prefixes after scan.
6. **Editors**: Document tree + zset/stream editors render without errors.
### Success Criteria: All tests pass and UI renders with expected elements.
### How to Execute:
- `make docker-up`
- `pnpm test:unit Redis Mongo DocumentEditor KeyBrowser -v`
- `cd src-tauri && cargo test -v`
- `pnpm typecheck && pnpm lint`

---

## Execution Options
1. **Subagent-Driven (this session)** — I dispatch a subagent per task and review after each.
2. **Parallel Session** — Open a new session using `superpowers:executing-plans` for batch execution.
