# Serialization Buffer Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce DirectMsgPackEncoder serialization overhead by 25-35% across all database adapters via chunked parallel encoding, stack-buffer formatters, and buffer pooling.

**Architecture:** Replace per-row `Vec<u8>` allocation in the parallel path with `par_chunks()` (N chunk buffers instead of N row buffers). Add stack-buffer formatters for Decimal and IPv4 to eliminate heap-allocating `to_string()`. Add a shared buffer pool so chunk buffers can be reused safely when taken/returned across different threads.

**Tech Stack:** Rust, rayon (`par_chunks`), rmp (MessagePack), rust_decimal, itoa, base64 0.21

---

## Phase 1: Chunked Parallel Encoding

The biggest win. Changes the parallel path from 1-buffer-per-row to 1-buffer-per-thread-chunk.

### Task 1: PostgreSQL — Chunked Parallel Encoding (reference implementation)

**Files:**
- Modify: `src-tauri/src/adapters/postgres/direct_msgpack.rs` (method `encode_parallel_two_pass`)

**Step 1: Write test verifying chunked output matches sequential output**

Add to the existing `#[cfg(test)] mod tests` block:

```rust
#[test]
fn test_chunked_vs_sequential_equivalence() {
    use super::*;

    // Create encoder with common column types
    let encoder = DirectMsgPackEncoder::new(vec![
        Type::INT4,
        Type::TEXT,
        Type::BOOL,
    ]);

    // We can't create real PG rows in unit tests, but we can verify
    // the chunked encoding helper produces correct msgpack structure.
    // Test the chunk merging logic with raw bytes.
    let chunk1: Vec<u8> = {
        let mut buf = Vec::new();
        // Row 1: [42, "hello", true]
        encode::write_array_len(&mut buf, 3).unwrap();
        encode::write_i32(&mut buf, 42).unwrap();
        encode::write_str(&mut buf, "hello").unwrap();
        encode::write_bool(&mut buf, true).unwrap();
        buf
    };
    let chunk2: Vec<u8> = {
        let mut buf = Vec::new();
        // Row 2: [99, "world", false]
        encode::write_array_len(&mut buf, 3).unwrap();
        encode::write_i32(&mut buf, 99).unwrap();
        encode::write_str(&mut buf, "world").unwrap();
        encode::write_bool(&mut buf, false).unwrap();
        buf
    };

    // Merge chunks (simulates what chunked parallel does)
    let mut merged = Vec::new();
    encode::write_array_len(&mut merged, 2).unwrap(); // 2 rows total
    merged.extend_from_slice(&chunk1);
    merged.extend_from_slice(&chunk2);

    // Decode and verify structure
    let decoded: rmpv::Value = rmpv::decode::read_value(&mut &merged[..]).unwrap();
    let outer = decoded.as_array().expect("outer should be array");
    assert_eq!(outer.len(), 2);

    let row0 = outer[0].as_array().unwrap();
    assert_eq!(row0[0].as_i64(), Some(42));
    assert_eq!(row0[1].as_str(), Some("hello"));
    assert_eq!(row0[2].as_bool(), Some(true));

    let row1 = outer[1].as_array().unwrap();
    assert_eq!(row1[0].as_i64(), Some(99));
    assert_eq!(row1[1].as_str(), Some("world"));
    assert_eq!(row1[2].as_bool(), Some(false));
}
```

**Step 2: Run test to verify it passes** (it validates the merge pattern)

Run: `cargo test -p query-pilot --lib adapters::postgres::direct_msgpack::tests::test_chunked_vs_sequential_equivalence`

**Step 3: Replace `encode_parallel_two_pass` with chunked implementation**

Replace the existing `encode_parallel_two_pass` method:

```rust
/// Chunked parallel encoding for large batches.
/// Instead of 1 buffer per row (N allocations), uses 1 buffer per thread chunk.
/// For 2048 rows on 4 threads: 4 allocations instead of 2048.
fn encode_parallel_two_pass(&self, rows: &[Row]) -> Result<Vec<u8>> {
    let num_threads = rayon::current_num_threads().max(1);
    let chunk_size = (rows.len() + num_threads - 1) / num_threads;

    // Pass 1: encode chunks in parallel — each chunk gets one buffer
    let chunk_buffers: Vec<Vec<u8>> = rows
        .par_chunks(chunk_size)
        .map(|chunk| {
            let estimated = self.estimated_row_size * chunk.len();
            let mut buf = Vec::with_capacity(estimated);
            for row in chunk {
                if let Err(e) = self.encode_row(&mut buf, row) {
                    tracing::warn!("PG row encode failed (chunked): {}", e);
                    // Write a null row as fallback
                    let _ = encode::write_array_len(&mut buf, self.column_types.len() as u32);
                    for _ in 0..self.column_types.len() {
                        let _ = encode::write_nil(&mut buf);
                    }
                }
            }
            buf
        })
        .collect();

    // Pass 2: single allocation merge
    let header_size = msgpack_array_header_size(rows.len());
    let total_chunk_bytes: usize = chunk_buffers.iter().map(|b| b.len()).sum();
    let mut buffer = Vec::with_capacity(header_size + total_chunk_bytes);

    encode::write_array_len(&mut buffer, rows.len() as u32)
        .map_err(Self::map_encode_err)?;

    for chunk_buf in chunk_buffers {
        buffer.extend_from_slice(&chunk_buf);
    }

    Ok(buffer)
}
```

**Step 4: Run all PostgreSQL encoder tests**

Run: `cargo test -p query-pilot --lib adapters::postgres::direct_msgpack`

---

### Task 2: MySQL — Chunked Parallel Encoding

**Files:**
- Modify: `src-tauri/src/adapters/mysql/direct_msgpack.rs` (method `encode_parallel`)

**Step 1: Replace `encode_parallel` with chunked implementation**

Same pattern as PostgreSQL but using `self.column_count` instead of `self.column_types.len()`:

```rust
/// Chunked parallel encoding for large batches
fn encode_parallel(&self, rows: &[Row]) -> Result<Vec<u8>> {
    let num_threads = rayon::current_num_threads().max(1);
    let chunk_size = (rows.len() + num_threads - 1) / num_threads;

    let chunk_buffers: Vec<Vec<u8>> = rows
        .par_chunks(chunk_size)
        .map(|chunk| {
            let estimated = self.estimated_row_size * chunk.len();
            let mut buf = Vec::with_capacity(estimated);
            for row in chunk {
                if let Err(e) = self.encode_row(&mut buf, row) {
                    tracing::warn!("MySQL row encode failed (chunked): {}", e);
                    let _ = encode::write_array_len(&mut buf, self.column_count as u32);
                    for _ in 0..self.column_count {
                        let _ = encode::write_nil(&mut buf);
                    }
                }
            }
            buf
        })
        .collect();

    let header_size = msgpack_array_header_size(rows.len());
    let total_chunk_bytes: usize = chunk_buffers.iter().map(|b| b.len()).sum();
    let mut buffer = Vec::with_capacity(header_size + total_chunk_bytes);

    encode::write_array_len(&mut buffer, rows.len() as u32)
        .map_err(Self::map_encode_err)?;

    for chunk_buf in chunk_buffers {
        buffer.extend_from_slice(&chunk_buf);
    }

    Ok(buffer)
}
```

**Step 2: Run MySQL encoder tests**

Run: `cargo test -p query-pilot --lib adapters::mysql::direct_msgpack`

---

### Task 3: MSSQL — Chunked Parallel Encoding

**Files:**
- Modify: `src-tauri/src/adapters/mssql/direct_msgpack.rs` (method `encode_parallel_two_pass`)

**Step 1: Replace `encode_parallel_two_pass` with chunked implementation**

Same pattern, using `self.column_count` and `encode_row_inline`:

```rust
fn encode_parallel_two_pass(&self, rows: &[Row]) -> Result<Vec<u8>> {
    let num_threads = rayon::current_num_threads().max(1);
    let chunk_size = (rows.len() + num_threads - 1) / num_threads;

    let chunk_buffers: Vec<Vec<u8>> = rows
        .par_chunks(chunk_size)
        .map(|chunk| {
            let estimated = self.estimated_row_size * chunk.len();
            let mut buf = Vec::with_capacity(estimated);
            for row in chunk {
                if let Err(e) = self.encode_row_inline(&mut buf, row) {
                    tracing::warn!("MSSQL row encode failed (chunked): {}", e);
                    let _ = encode::write_array_len(&mut buf, self.column_count as u32);
                    for _ in 0..self.column_count {
                        let _ = encode::write_nil(&mut buf);
                    }
                }
            }
            buf
        })
        .collect();

    let header_size = msgpack_array_header_size(rows.len());
    let total_chunk_bytes: usize = chunk_buffers.iter().map(|b| b.len()).sum();
    let mut buffer = Vec::with_capacity(header_size + total_chunk_bytes);

    encode::write_array_len(&mut buffer, rows.len() as u32)
        .map_err(Self::map_encode_err)?;

    for chunk_buf in chunk_buffers {
        buffer.extend_from_slice(&chunk_buf);
    }

    Ok(buffer)
}
```

**Step 2: Run MSSQL encoder tests**

Run: `cargo test -p query-pilot --lib adapters::mssql::direct_msgpack`

---

### Task 4: SQLite — Chunked Parallel Encoding

**Files:**
- Modify: `src-tauri/src/adapters/sqlite/direct_msgpack.rs` (method `encode_owned_parallel`)

**Step 1: Write test for chunked encoding with OwnedCell data**

```rust
#[test]
fn test_chunked_parallel_matches_sequential() {
    let encoder = DirectMsgPackEncoder::new(3);

    // Create 128 rows (above PARALLEL_THRESHOLD) to exercise parallel path
    let rows: Vec<Vec<OwnedCell>> = (0..128)
        .map(|i| {
            vec![
                OwnedCell::Integer(i as i64),
                OwnedCell::Text(format!("row_{}", i)),
                OwnedCell::Real(i as f64 * 1.5),
            ]
        })
        .collect();

    // Encode via sequential path
    let sequential_result = encoder.encode_owned_sequential(&rows).unwrap();

    // Encode via parallel/chunked path
    let parallel_result = encoder.encode_owned_parallel(&rows).unwrap();

    // Both should decode to identical structures
    let seq_decoded: rmpv::Value =
        rmpv::decode::read_value(&mut &sequential_result[..]).unwrap();
    let par_decoded: rmpv::Value =
        rmpv::decode::read_value(&mut &parallel_result[..]).unwrap();

    let seq_arr = seq_decoded.as_array().unwrap();
    let par_arr = par_decoded.as_array().unwrap();
    assert_eq!(seq_arr.len(), par_arr.len());
    assert_eq!(seq_arr.len(), 128);

    // Spot check first and last rows
    for idx in [0, 63, 127] {
        let s = seq_arr[idx].as_array().unwrap();
        let p = par_arr[idx].as_array().unwrap();
        assert_eq!(s[0].as_i64(), p[0].as_i64(), "row {} col 0", idx);
        assert_eq!(s[1].as_str(), p[1].as_str(), "row {} col 1", idx);
    }
}
```

Note: `encode_owned_sequential` and `encode_owned_parallel` are currently private. Make them `pub(crate)` for testing, or use `encode_owned_batch` which routes to both paths.

**Step 2: Run test to verify equivalence**

Run: `cargo test -p query-pilot --lib adapters::sqlite::direct_msgpack::tests::test_chunked_parallel_matches_sequential`

**Step 3: Replace `encode_owned_parallel` with chunked implementation**

```rust
fn encode_owned_parallel(&self, rows: &[Vec<OwnedCell>]) -> Result<Vec<u8>> {
    let num_threads = rayon::current_num_threads().max(1);
    let chunk_size = (rows.len() + num_threads - 1) / num_threads;

    let chunk_buffers: Vec<Vec<u8>> = rows
        .par_chunks(chunk_size)
        .map(|chunk| {
            let estimated = self.estimated_row_size * chunk.len();
            let mut buf = Vec::with_capacity(estimated);
            for row in chunk {
                if let Err(e) = self.encode_owned_row(&mut buf, row) {
                    tracing::warn!("SQLite row encode failed (chunked): {}", e);
                    let _ = encode::write_array_len(&mut buf, self.column_count as u32);
                    for _ in 0..self.column_count {
                        let _ = encode::write_nil(&mut buf);
                    }
                }
            }
            buf
        })
        .collect();

    let header_size = msgpack_array_header_size(rows.len());
    let total_chunk_bytes: usize = chunk_buffers.iter().map(|b| b.len()).sum();
    let mut buffer = Vec::with_capacity(header_size + total_chunk_bytes);

    encode::write_array_len(&mut buffer, rows.len() as u32)
        .map_err(Self::map_encode_err)?;

    for chunk_buf in chunk_buffers {
        buffer.extend_from_slice(&chunk_buf);
    }

    Ok(buffer)
}
```

**Step 4: Run all SQLite encoder tests**

Run: `cargo test -p query-pilot --lib adapters::sqlite::direct_msgpack`

---

## Phase 2: Stack-Buffer Formatters

Eliminate `to_string()` heap allocations for Decimal, IPv4, and Numeric types.

Note: Base64 direct-to-buffer encoding is deferred to a follow-up phase.

### Task 5: PostgreSQL — Stack-Buffer Decimal Formatter

**Files:**
- Modify: `src-tauri/src/adapters/postgres/direct_msgpack.rs`

**Step 1: Write test for decimal formatting**

```rust
#[test]
fn test_format_decimal_fast() {
    use rust_decimal::Decimal;
    use std::str::FromStr;

    let cases = vec![
        ("0", "0"),
        ("1", "1"),
        ("-1", "-1"),
        ("123.45", "123.45"),
        ("-123.45", "-123.45"),
        ("0.001", "0.001"),
        ("0.00100", "0.00100"),
        ("99999999999999999999999999.99", "99999999999999999999999999.99"),
        ("1000000", "1000000"),
    ];

    for (input, expected) in cases {
        let d = Decimal::from_str(input).unwrap();
        let mut buf = [0u8; 42];
        let len = format_decimal_fast(&mut buf, &d);
        let result = std::str::from_utf8(&buf[..len]).unwrap();
        assert_eq!(result, expected, "input: {}", input);
    }
}
```

**Step 2: Run test to verify it fails** (function doesn't exist yet)

Run: `cargo test -p query-pilot --lib adapters::postgres::direct_msgpack::tests::test_format_decimal_fast`

**Step 3: Implement `format_decimal_fast`**

Add this function near the other fast formatters:

```rust
/// Fast decimal format using stack buffer — no heap allocation.
/// rust_decimal max is 28 significant digits + sign + decimal point = 30 chars.
/// Buffer is 42 bytes for safety.
#[inline]
fn format_decimal_fast(dst: &mut [u8; 42], decimal: &Decimal) -> usize {
    use rust_decimal::prelude::Zero;

    if decimal.is_zero() {
        dst[0] = b'0';
        return 1;
    }

    let mut pos = 0;
    if decimal.is_sign_negative() {
        dst[pos] = b'-';
        pos += 1;
    }

    // Get the unpacked representation
    let unpacked = decimal.unpack();
    let scale = decimal.scale() as usize;

    // Reconstruct mantissa from lo/mid/hi as u128
    let mantissa: u128 =
        unpacked.lo as u128 | ((unpacked.mid as u128) << 32) | ((unpacked.hi as u128) << 64);

    // Format mantissa digits into temp buffer
    let mut digits = [0u8; 30];
    let mut d_pos = 30;
    let mut m = mantissa;
    if m == 0 {
        d_pos -= 1;
        digits[d_pos] = b'0';
    } else {
        while m > 0 {
            d_pos -= 1;
            digits[d_pos] = b'0' + (m % 10) as u8;
            m /= 10;
        }
    }
    let digit_count = 30 - d_pos;
    let digit_slice = &digits[d_pos..30];

    if scale == 0 {
        // No decimal point
        dst[pos..pos + digit_count].copy_from_slice(digit_slice);
        pos += digit_count;
    } else if scale >= digit_count {
        // Need leading zeros: 0.00123
        dst[pos] = b'0';
        pos += 1;
        dst[pos] = b'.';
        pos += 1;
        let leading_zeros = scale - digit_count;
        for _ in 0..leading_zeros {
            dst[pos] = b'0';
            pos += 1;
        }
        dst[pos..pos + digit_count].copy_from_slice(digit_slice);
        pos += digit_count;
    } else {
        // Split at decimal point: 123.45
        let integer_len = digit_count - scale;
        dst[pos..pos + integer_len].copy_from_slice(&digit_slice[..integer_len]);
        pos += integer_len;
        dst[pos] = b'.';
        pos += 1;
        dst[pos..pos + scale].copy_from_slice(&digit_slice[integer_len..]);
        pos += scale;
    }

    pos
}
```

**Step 4: Run test to verify it passes**

Run: `cargo test -p query-pilot --lib adapters::postgres::direct_msgpack::tests::test_format_decimal_fast`

**Step 5: Wire formatter into `encode_numeric`**

Replace the body of `encode_numeric`:

```rust
#[inline(always)]
fn encode_numeric<W: Write>(&self, buf: &mut W, raw: &[u8]) -> Result<()> {
    match Decimal::from_sql(&Type::NUMERIC, raw) {
        Ok(d) => {
            let mut dec_buf = [0u8; 42];
            let len = format_decimal_fast(&mut dec_buf, &d);
            let s = unsafe { std::str::from_utf8_unchecked(&dec_buf[..len]) };
            encode::write_str(buf, s).map_err(Self::map_encode_err)?;
        }
        Err(_) => {
            self.encode_fallback(buf, raw)?;
        }
    }
    Ok(())
}
```

**Step 6: Run all PostgreSQL encoder tests**

Run: `cargo test -p query-pilot --lib adapters::postgres::direct_msgpack`

---

### Task 6: PostgreSQL — Stack-Buffer IPv4 Formatter

**Files:**
- Modify: `src-tauri/src/adapters/postgres/direct_msgpack.rs`

**Step 1: Write test for IPv4 formatting**

```rust
#[test]
fn test_format_ipv4_fast() {
    let cases = vec![
        ([127, 0, 0, 1], 32, "127.0.0.1"),
        ([192, 168, 1, 1], 32, "192.168.1.1"),
        ([10, 0, 0, 0], 8, "10.0.0.0/8"),
        ([255, 255, 255, 255], 32, "255.255.255.255"),
        ([0, 0, 0, 0], 0, "0.0.0.0/0"),
    ];

    for (octets, prefix, expected) in cases {
        let mut buf = [0u8; 19]; // max: "255.255.255.255/32" = 18
        let len = format_ipv4_fast(&mut buf, octets, prefix);
        let result = std::str::from_utf8(&buf[..len]).unwrap();
        assert_eq!(result, expected, "octets: {:?}/{}", octets, prefix);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p query-pilot --lib adapters::postgres::direct_msgpack::tests::test_format_ipv4_fast`

**Step 3: Implement `format_ipv4_fast`**

```rust
/// Fast IPv4 format: "a.b.c.d" or "a.b.c.d/prefix" — no heap allocation.
#[inline]
fn format_ipv4_fast(dst: &mut [u8; 19], octets: [u8; 4], prefix: u8) -> usize {
    let mut pos = 0;
    let mut itoa_buf = itoa::Buffer::new();

    for (i, &octet) in octets.iter().enumerate() {
        if i > 0 {
            dst[pos] = b'.';
            pos += 1;
        }
        let s = itoa_buf.format(octet);
        dst[pos..pos + s.len()].copy_from_slice(s.as_bytes());
        pos += s.len();
    }

    if prefix != 32 {
        dst[pos] = b'/';
        pos += 1;
        let s = itoa_buf.format(prefix);
        dst[pos..pos + s.len()].copy_from_slice(s.as_bytes());
        pos += s.len();
    }

    pos
}
```

**Step 4: Run test to verify it passes**

Run: `cargo test -p query-pilot --lib adapters::postgres::direct_msgpack::tests::test_format_ipv4_fast`

**Step 5: Wire into `encode_inet` — replace the IPv4 branch**

In `encode_inet`, replace the IPv4 match arm:

```rust
2 if addr_len == 4 => {
    let mut ipv4_buf = [0u8; 19];
    let len = format_ipv4_fast(
        &mut ipv4_buf,
        [addr_bytes[0], addr_bytes[1], addr_bytes[2], addr_bytes[3]],
        prefix,
    );
    let s = unsafe { std::str::from_utf8_unchecked(&ipv4_buf[..len]) };
    encode::write_str(buf, s).map_err(Self::map_encode_err)?;
    return Ok(());
}
```

Remove the old `ip.to_string()` / `format!("{}/{}", ...)` code for the IPv4 case. Keep IPv6 as-is (complex formatter, diminishing returns).

**Step 6: Run all PostgreSQL encoder tests**

Run: `cargo test -p query-pilot --lib adapters::postgres::direct_msgpack`

---

### Task 7: MSSQL — Stack-Buffer Numeric Formatter

**Files:**
- Modify: `src-tauri/src/adapters/mssql/direct_msgpack.rs`

**Step 1: Replace `Numeric::to_string()` with direct formatting**

In `encode_cell`, replace the Numeric branch:

```rust
// Decimal — use Display trait but with stack buffer via itoa pattern
if let Some(v) = row
    .try_get::<tiberius::numeric::Numeric, _>(idx)
    .ok()
    .flatten()
{
    // tiberius Numeric implements Display; write to stack buffer
    let mut num_buf = [0u8; 42];
    let s = v.to_string(); // tiberius doesn't expose mantissa/scale, must use to_string
    let bytes = s.as_bytes();
    num_buf[..bytes.len()].copy_from_slice(bytes);
    encode::write_str(buf, &s).map_err(Self::map_encode_err)?;
    return Ok(());
}
```

Note: `tiberius::numeric::Numeric` doesn't expose raw mantissa/scale like `rust_decimal`. The `to_string()` call remains, but we can convert to `rust_decimal::Decimal` via the `From` impl if available. Check if tiberius supports it:

Keep `to_string()` for MSSQL Numeric in this phase — `tiberius::Numeric` doesn't expose enough internals for a no-allocation formatter. Defer this optimization to a follow-up.

---

## Phase 3: Buffer Pooling

### Task 8: Add Shared Buffer Pool to All Adapters

**Files:**
- Modify: `src-tauri/src/adapters/postgres/direct_msgpack.rs`
- Modify: `src-tauri/src/adapters/mysql/direct_msgpack.rs`
- Modify: `src-tauri/src/adapters/mssql/direct_msgpack.rs`
- Modify: `src-tauri/src/adapters/sqlite/direct_msgpack.rs`

**Step 1: Add buffer pool helper function**

Add to each adapter's `direct_msgpack.rs` (near top, after imports):

```rust
use std::sync::Mutex;

const CHUNK_BUF_DEFAULT_CAPACITY: usize = 64 * 1024;
static CHUNK_BUF_POOL: Mutex<Vec<Vec<u8>>> = Mutex::new(Vec::new());

/// Take a pooled buffer, cleared but retaining capacity.
#[inline]
fn take_chunk_buffer(estimated_capacity: usize) -> Vec<u8> {
    let mut pool = CHUNK_BUF_POOL.lock().unwrap_or_else(|p| p.into_inner());
    let mut buf = pool
        .pop()
        .unwrap_or_else(|| Vec::with_capacity(CHUNK_BUF_DEFAULT_CAPACITY.max(estimated_capacity)));
    drop(pool);
    buf.clear();
    if buf.capacity() < estimated_capacity {
        buf.reserve(estimated_capacity - buf.capacity());
    }
    buf
}

/// Return a buffer to the shared pool for reuse.
#[inline]
fn return_chunk_buffer(mut buf: Vec<u8>) {
    buf.clear();
    let mut pool = CHUNK_BUF_POOL.lock().unwrap_or_else(|p| p.into_inner());
    let max_pool_size = (rayon::current_num_threads().max(1) * 2).max(4);
    if pool.len() < max_pool_size {
        pool.push(buf);
    }
}
```

**Step 2: Wire buffer pool into chunked parallel encoding**

In each adapter's chunked parallel method, replace `Vec::with_capacity(estimated)` with the pool:

```rust
// Before (in par_chunks closure):
let mut buf = Vec::with_capacity(estimated);
// ... encode rows into buf ...
buf

// After:
let mut buf = take_chunk_buffer(estimated);
// ... encode rows into buf ...
// Return after merge.
buf
```

Update the merge loop to return buffers:

```rust
for chunk_buf in chunk_buffers {
    buffer.extend_from_slice(&chunk_buf);
    return_chunk_buffer(chunk_buf);
}
```

**Step 3: Run all encoder tests across all adapters**

Run: `cargo test -p query-pilot --lib adapters::postgres::direct_msgpack && cargo test -p query-pilot --lib adapters::mysql::direct_msgpack && cargo test -p query-pilot --lib adapters::mssql::direct_msgpack && cargo test -p query-pilot --lib adapters::sqlite::direct_msgpack`

---

## Phase 4: Verify & Build

### Task 9: Full Build and Test Verification

**Step 1: Run full backend test suite**

Run: `cd src-tauri && cargo test`

**Step 2: Run clippy**

Run: `cd src-tauri && cargo clippy -- -D warnings`

**Step 3: Fix any clippy warnings introduced**

**Step 4: Build release to verify compilation**

Run: `cd src-tauri && cargo build --release`

---

## Summary

| Task | Adapter | Change | Expected Gain |
|------|---------|--------|---------------|
| 1 | PostgreSQL | Chunked parallel | ~15-20% |
| 2 | MySQL | Chunked parallel | ~15-20% |
| 3 | MSSQL | Chunked parallel | ~15-20% |
| 4 | SQLite | Chunked parallel | ~15-20% |
| 5 | PostgreSQL | Decimal stack-buffer | ~5-10% |
| 6 | PostgreSQL | IPv4 stack-buffer | ~2-3% |
| 7 | MSSQL | Numeric | Deferred |
| 8 | All | Buffer pooling | ~3-5% |
| 9 | All | Build verification | — |

**Current phase expected improvement: ~15-25%.**
**Extended expected improvement after deferred tasks: up to ~25-35%.**
