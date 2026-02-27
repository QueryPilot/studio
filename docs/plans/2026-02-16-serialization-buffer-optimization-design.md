# Serialization Buffer Optimization Design

**Date**: 2026-02-16
**Status**: Approved
**Goal**: Reduce serialization/conversion overhead from 20-50% to ~13-35% of query time

## Problem

The DirectMsgPackEncoder parallel path allocates a separate `Vec<u8>` per row, then merges them all into a final buffer. For a 2048-row batch, that's 2048 heap allocations + 2048 `extend_from_slice` copies. Additional overhead comes from `to_string()` calls for Decimal/INET/Base64 types.

## Approach: Direct-to-Buffer Encoding (Approach A)

Pure backend changes. No wire format, protocol, or frontend changes.

### 1. Chunked Parallel Encoding (~15-20% improvement)

**Current**: Each row encodes into its own `Vec<u8>`, all merged at the end.

```
row0→buf0, row1→buf1, ... row2047→buf2047 → merge 2048 bufs
```

**New**: Divide rows into N chunks (one per rayon thread). Each chunk encodes all its rows sequentially into one pre-sized buffer. Final merge is N copies instead of 2048.

```
chunk0(512 rows)→buf0, chunk1→buf1, chunk2→buf2, chunk3→buf3 → merge 4 bufs
```

Implementation: Use `par_chunks()` instead of `par_iter()` with safe ceil division chunk size = `(rows.len() + threads - 1) / threads` (never 0).

Applies to all 4 adapters: Postgres, MySQL, MSSQL, SQLite.

### 2. Eliminate Intermediate String Allocations (~5-10% improvement)

Replace `to_string()` calls with stack-buffer formatters:

- **Implemented in this change**: PostgreSQL Decimal and IPv4 stack-buffer formatting
- **Deferred follow-ups**: Base64 direct-to-buffer writes, IPv6 stack formatter, and MSSQL Numeric optimization

Applies now to: PostgreSQL Decimal + IPv4 INET formatting.
Deferred applies-to scope: Postgres CIDR/base64, MSSQL Numeric/base64, MySQL base64, SQLite base64.

### 3. Buffer Pooling (~3-5% improvement)

Use a shared buffer pool for chunk buffers:

```rust
const CHUNK_BUF_DEFAULT_CAPACITY: usize = 64 * 1024;
static CHUNK_BUF_POOL: Mutex<Vec<Vec<u8>>> = Mutex::new(Vec::new());
```

Applies to all 4 adapters.

## What Does NOT Change

- Wire format (MsgPack arrays of display-ready values)
- Frontend code (decode worker, queryStreamClient, DataGrid)
- Progressive batching strategy (16 → 2048)
- Sequential path for <64 rows
- Public API / IPC channel protocol

## Expected Outcome

Current phase expectation: ~15-25% reduction from chunked encoding + pooling + PG hot-path string formatting.

Extended expectation (after deferred base64/numeric work): up to ~25-35%.

## Files to Modify

- `src-tauri/src/adapters/postgres/direct_msgpack.rs`
- `src-tauri/src/adapters/mysql/direct_msgpack.rs`
- `src-tauri/src/adapters/mssql/direct_msgpack.rs`
- `src-tauri/src/adapters/sqlite/direct_msgpack.rs`
