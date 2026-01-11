# Binary Type Decoders Design

## Overview

Add proper decoders for PostgreSQL binary types that currently fall through to `encode_fallback` (resulting in garbage or base64 output).

## Scope

**Decode only** - Read path converts PG binary → display string
**Writes** - Use SQL literals with `::type` cast (no binary encoder needed)

## Types to Implement

| Type | Binary Format | Display Format | Complexity |
|------|---------------|----------------|------------|
| `box` | 4×f64 (32 bytes) | `((x1,y1),(x2,y2))` | Simple |
| `circle` | 3×f64 (24 bytes) | `<(x,y),r>` | Simple |
| `line` | 3×f64 (24 bytes) | `{A,B,C}` | Simple |
| `lseg` | 4×f64 (32 bytes) | `[(x1,y1),(x2,y2)]` | Simple |
| `path` | flag + n_points + points | `[(p1),(p2)]` or `((p1),(p2))` | Medium |
| `polygon` | n_points + points | `((p1),(p2),(p3))` | Medium |
| `tsvector` | n_lexemes + lexemes/positions | `'word':1,2 'other':3` | Complex |
| `hstore` | n_pairs + key/value strings | `"k"=>"v", "k2"=>"v2"` | Complex |

## Implementation

All decoders added to `src-tauri/src/adapters/postgres/direct_msgpack.rs`.

### Pattern

```rust
fn encode_TYPE<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
    if raw.len() < MIN_SIZE { return self.encode_fallback(buf, raw); }

    // Parse binary format
    // Format to string (stack buffer when possible)
    // Write via encode::write_str
}
```

### Type Registration

Add to `encode_simple()` match:

```rust
Type::BOX => self.encode_box(buf, raw)?,
Type::CIRCLE => self.encode_circle(buf, raw)?,
Type::LINE => self.encode_line(buf, raw)?,
Type::LSEG => self.encode_lseg(buf, raw)?,
Type::PATH => self.encode_path(buf, raw)?,
Type::POLYGON => self.encode_polygon(buf, raw)?,
```

For extension types (tsvector, hstore), check by type name in fallback.

## Testing

```sql
-- Test queries
SELECT '((0,0),(1,1))'::box;
SELECT '<(0,0),5>'::circle;
SELECT '[(0,0),(1,1)]'::lseg;
SELECT '{1,2,3}'::line;
SELECT '((0,0),(1,1),(2,0))'::polygon;
SELECT '[(0,0),(1,1),(2,2)]'::path;
SELECT 'cat fat rat'::tsvector;
SELECT '"a"=>"1", "b"=>"2"'::hstore;
```
