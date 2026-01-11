# Simplified Two-Path Converter Architecture

## Date: 2025-12-27

## Overview

Refactor the PostgreSQL query execution to use two optimized paths:
1. **High-Volume Path**: MessagePack streaming for Query Panel (existing `DirectMsgPackEncoder`)
2. **Low-Volume Path**: Simple JSON converter for introspection/CRUD (new `SimpleConverter`)

## Current State Analysis

### Files to Remove
| File | Lines | Purpose | Why Remove |
|------|-------|---------|------------|
| `fast_converter.rs` | ~800 | Row → `Vec<serde_json::Value>` | Over-engineered, wasteful JSONB parsing |
| `query_fast.rs` | ~90 | Wrapper for fast_converter | No longer needed |

### Files to Keep
| File | Lines | Purpose |
|------|-------|---------|
| `direct_msgpack.rs` | ~1700 | High-performance MessagePack streaming |

### Files to Create
| File | Est. Lines | Purpose |
|------|------------|---------|
| `simple_converter.rs` | ~80 | Minimal type conversion for introspection/CRUD |

## JSON Library Analysis

### Current Usage of `serde_json`
1. **HTTP server**: Argument parsing (`from_value`) and response serialization (`to_value`)
2. **QueryResult**: `Vec<Vec<serde_json::Value>>` for row data
3. **CellValue**: `Json(serde_json::Value)` variant
4. **Error handling**: Conversion from `serde_json::Error`

### sonic-rs Evaluation
| Aspect | serde_json | sonic-rs |
|--------|------------|----------|
| Parse speed | Baseline | 2-3x faster |
| Serialize speed | Baseline | 2x faster |
| Drop-in replacement | N/A | Partial (Value type differs) |
| Complexity | Low | Medium (arena-based) |

### Recommendation
**Keep serde_json** for now because:
1. **Streaming path doesn't parse JSON** - JSONB/JSON passed through as raw bytes
2. **Simple path only handles basic types** - text, int, bool (no JSON columns)
3. **HTTP payloads are small** - Switching libraries for marginal gains
4. **sonic-rs Value differs** - Would require refactoring QueryResult, CellValue

**Future consideration**: If profiling shows HTTP serialization as bottleneck, sonic-rs can be added for specific hot paths using its serde compatibility.

## Implementation Plan

### Phase 1: Create SimpleConverter

```rust
// src-tauri/src/adapters/postgres/simple_converter.rs
use postgres_types::Type;
use serde_json::Value;
use tokio_postgres::Row;

pub struct SimpleConverter;

impl SimpleConverter {
    /// Convert rows to JSON - optimized for introspection queries
    /// Only handles types returned by information_schema/pg_catalog
    pub fn rows_to_json(rows: &[Row]) -> Vec<Vec<Value>> {
        rows.iter().map(Self::row_to_json).collect()
    }

    fn row_to_json(row: &Row) -> Vec<Value> {
        (0..row.len())
            .map(|i| Self::cell_to_json(row, i))
            .collect()
    }

    fn cell_to_json(row: &Row, idx: usize) -> Value {
        let col = &row.columns()[idx];

        match *col.type_() {
            // Boolean
            Type::BOOL => row.get::<_, Option<bool>>(idx)
                .map_or(Value::Null, Value::Bool),

            // Integers
            Type::INT2 => row.get::<_, Option<i16>>(idx)
                .map_or(Value::Null, |v| Value::Number(v.into())),
            Type::INT4 | Type::OID => row.get::<_, Option<i32>>(idx)
                .map_or(Value::Null, |v| Value::Number(v.into())),
            Type::INT8 => row.get::<_, Option<i64>>(idx)
                .map_or(Value::Null, |v| Value::Number(v.into())),

            // Text types (most common in introspection)
            Type::TEXT | Type::VARCHAR | Type::NAME | Type::BPCHAR | Type::CHAR => {
                row.get::<_, Option<String>>(idx)
                    .map_or(Value::Null, Value::String)
            }

            // JSON/JSONB - pass through as string (no parsing!)
            Type::JSON | Type::JSONB => {
                row.get::<_, Option<String>>(idx)
                    .map_or(Value::Null, Value::String)
            }

            // Fallback: try as string
            _ => row.try_get::<_, String>(idx)
                .ok()
                .map_or(Value::Null, Value::String)
        }
    }
}
```

### Phase 2: Update PostgresAdapter

```rust
// In adapter.rs - replace query method

async fn query(&self, sql: &str) -> Result<QueryResult> {
    let pool = self.pool.as_ref()
        .ok_or_else(|| AppError::ConnectionClosed("Not connected".into()))?;

    let conn = pool.get().await
        .map_err(|e| AppError::Internal(format!("Pool error: {}", e)))?;

    let rows = conn.query(sql, &[]).await?;

    // Build column metadata
    let columns = if rows.is_empty() {
        vec![]
    } else {
        rows[0].columns().iter().map(|col| ColumnMeta {
            name: col.name().to_string(),
            db_type: col.type_().name().to_string(),
            // ... other fields with defaults
        }).collect()
    };

    // Use simple converter
    let json_rows = SimpleConverter::rows_to_json(&rows);

    Ok(QueryResult { columns, rows: json_rows })
}
```

### Phase 3: Remove Legacy Files

1. Delete `src-tauri/src/adapters/postgres/fast_converter.rs`
2. Delete `src-tauri/src/adapters/postgres/query_fast.rs`
3. Update `src-tauri/src/adapters/postgres/mod.rs`:
   - Remove `pub mod fast_converter;`
   - Remove `pub mod query_fast;`
   - Remove related `pub use` statements
4. Update `src-tauri/src/adapters/postgres/adapter.rs`:
   - Remove `query_executor` field
   - Remove `FastPostgresQueryExecutor` import
   - Inline the simple query logic

### Phase 4: Update Dependencies

In `Cargo.toml`, verify we no longer need any special features that were only used by fast_converter.

## Testing Strategy

1. **Unit tests**: Add tests for SimpleConverter in `simple_converter.rs`
2. **Integration tests**: Verify introspection endpoints still work
3. **CRUD tests**: Verify CRUD operations still function
4. **Regression tests**: Run full test suite `make t`

## Performance Expectations

| Metric | Before | After | Reason |
|--------|--------|-------|--------|
| JSONB parsing | Parse + re-serialize | Zero (pass-through) | Eliminated redundant work |
| Code size | ~890 lines | ~80 lines | 91% reduction |
| Memory allocations | Multiple per cell | Minimal | Simpler code path |
| Introspection speed | Fast | Same or faster | Reduced complexity |

## Rollback Plan

If issues arise:
1. Revert the commit
2. Files are in git history
3. No database changes required

## Success Criteria

- [ ] All existing tests pass (`make t`)
- [ ] Introspection endpoints return correct data
- [ ] CRUD operations work correctly
- [ ] No JSON/JSONB parsing in simple path
- [ ] Code reduction of ~800 lines achieved
