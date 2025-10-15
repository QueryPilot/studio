# Remote Connection Slowness - Analysis & Solutions

## 🔴 The Problem

**Symptom:** First query on remote PostgreSQL takes **4-5 seconds**, every time you change the query.

**Example from logs:**

```
Query: SELECT * FROM transactions LIMIT 300
  ⏱ Got connection from pool: <1ms
  ⏱ PREPARE statement: ~4000-5000ms ⚠️  ← THE BOTTLENECK
  ⏱ Started query_raw: <10ms
  ⏱ First row arrived: ~5000ms
Total: 5500ms
```

---

## 🔍 Root Cause

The **`PREPARE` statement** is slow on remote connections because PostgreSQL must:

1. **Parse** the SQL (network round-trip)
2. **Analyze** the query plan (network round-trip)
3. **Describe** the result format (network round-trip)

**Why other tools (TablePlus) are faster:**

- They use **simple query protocol** (`QUERY` command) instead of extended protocol (`PREPARE` + `BIND` + `EXECUTE`)
- Simple protocol: 1 round-trip
- Extended protocol: 3-4 round-trips
- On remote connections with high latency (100-200ms), this compounds to **4-5 seconds**!

---

## ✅ Current Status

We've added detailed timing to prove where the slowness is:

```rust
// New logging shows:
⏱ Got connection from pool: 1ms
⏱ PREPARE statement: 4500ms ⚠️  ← Confirmed bottleneck!
⏱ Started query_raw: 5ms
⏱ First row arrived: 200ms
```

---

## 💡 Potential Solutions

### Option 1: Statement Caching (Per-Connection) ⭐ RECOMMENDED

**Idea:** Cache prepared statements **per connection** (not globally).

**Implementation:**

```rust
// Store statement cache in connection wrapper
struct CachedConnection {
    conn: deadpool_postgres::Object,
    stmt_cache: HashMap<String, Statement>,
}

impl CachedConnection {
    async fn prepare_cached(&mut self, sql: &str) -> Result<&Statement> {
        if !self.stmt_cache.contains_key(sql) {
            let stmt = self.conn.prepare(sql).await?;
            self.stmt_cache.insert(sql.to_string(), stmt);
        }
        Ok(self.stmt_cache.get(sql).unwrap())
    }
}
```

**Pros:**

- ✅ Only prepares each unique query **once per connection**
- ✅ Safe with connection pooling (cache is tied to connection lifecycle)
- ✅ Subsequent queries are instant

**Cons:**

- ⚠️ Requires custom connection wrapper
- ⚠️ Memory overhead (but minimal for reasonable query counts)

**Expected improvement:**

- First query: 4500ms (still slow)
- Same query again: **<10ms** (cached!) ✨
- Different query: 4500ms (new prepare)

---

### Option 2: Use Simple Query Protocol

**Idea:** Use `simple_query()` instead of `prepare()` + `query_raw()`.

**Pros:**

- ✅ Only 1 network round-trip
- ✅ Should be ~100-200ms instead of 4-5 seconds

**Cons:**

- ❌ Loses type information (everything is strings)
- ❌ Loses streaming (returns all rows at once)
- ❌ More complex parsing on our side

**Not viable** due to loss of streaming and types.

---

### Option 3: Connection-Level Statement Cache (tokio-postgres built-in)

**Idea:** Use `tokio-postgres`'s built-in statement caching.

```rust
let config = "... statement_cache_capacity=100";
```

**Pros:**

- ✅ Built-in, no custom code

**Cons:**

- ⚠️ Only caches within a single connection
- ⚠️ With connection pooling, you might get different connections

**Status:** Need to investigate if this works with `deadpool`.

---

### Option 4: Pre-compile Common Queries

**Idea:** Pre-prepare common query patterns during connection setup.

```rust
// During pre-warming:
let _ = conn.prepare("SELECT * FROM transactions LIMIT $1").await;
let _ = conn.prepare("SELECT * FROM users LIMIT $1").await;
// ... for all common tables
```

**Pros:**

- ✅ First queries to common tables are instant

**Cons:**

- ⚠️ Only helps for predefined queries
- ⚠️ Won't help for ad-hoc queries or different tables
- ⚠️ Statements are lost when connection returns to pool

**Verdict:** Not effective with current architecture.

---

### Option 5: Keep-Alive Dedicated Query Connection

**Idea:** Have a dedicated connection that never returns to pool, used only for user queries.

**Pros:**

- ✅ Statement cache persists across queries
- ✅ No prepare overhead after first query

**Cons:**

- ❌ Uses an extra connection permanently
- ❌ Not scalable for multiple query tabs
- ❌ Complex to manage

**Verdict:** Too complex, not recommended.

---

## 🎯 Recommended Solution

**Implement Option 1: Per-Connection Statement Caching**

This gives us the best balance of:

- Performance (instant subsequent queries)
- Safety (cache tied to connection lifecycle)
- Complexity (moderate - one wrapper struct)

### Implementation Plan:

1. Create `CachedPostgresConnection` wrapper
2. Store `HashMap<String, Statement>` in the wrapper
3. Implement `prepare_cached()` method
4. Use wrapper in `execute_single_fetch_stream`
5. Cache invalidates automatically when connection returns to pool

### Expected Results:

**Before:**

```
Query 1 (SELECT * FROM transactions LIMIT 100): 5000ms
Query 2 (SELECT * FROM transactions LIMIT 200): 5000ms  ← Different query, re-prepare!
Query 3 (SELECT * FROM transactions LIMIT 100): 5000ms  ← Same as #1, still re-prepare!
```

**After:**

```
Query 1 (SELECT * FROM transactions LIMIT 100): 5000ms (first prepare)
Query 2 (SELECT * FROM transactions LIMIT 200): 5000ms (different SQL, new prepare)
Query 3 (SELECT * FROM transactions LIMIT 100): <10ms  (cached!)
Query 4 (SELECT * FROM users LIMIT 100): 5000ms (different table, new prepare)
Query 5 (SELECT * FROM users LIMIT 100): <10ms  (cached!)
```

---

## 📊 Current Performance Analysis

From your logs, the breakdown is:

| Phase                 | Time        | Percentage  |
| --------------------- | ----------- | ----------- |
| Get connection        | 1ms         | <0.1%       |
| **PREPARE statement** | **4500ms**  | **~90%** ⚠️ |
| Start query_raw       | 5ms         | <1%         |
| First row             | 200ms       | ~4%         |
| Data transfer         | 300ms       | ~6%         |
| **Total**             | **~5000ms** | **100%**    |

**The PREPARE is 90% of the problem!**

---

## 🚀 Next Steps

1. Implement per-connection statement caching
2. Test with your remote database
3. Measure improvement
4. Fine-tune cache size (default: 100 statements)

Would you like me to implement the per-connection statement caching solution?
