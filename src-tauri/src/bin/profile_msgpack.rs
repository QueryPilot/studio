use std::time::Instant;

use serde_json::Value as JsonValue;

fn arg_value<'a>(args: &'a [String], key: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == key)
        .and_then(|idx| args.get(idx + 1))
        .map(|s| s.as_str())
}

fn arg_flag(args: &[String], key: &str) -> bool {
    args.iter().any(|a| a == key)
}

fn parse_arg<T: std::str::FromStr>(args: &[String], key: &str, default: T) -> T {
    arg_value(args, key)
        .and_then(|v| v.parse::<T>().ok())
        .unwrap_or(default)
}

fn padded_string(row: usize, col: usize, len: usize) -> String {
    let base = format!("r{row}_c{col}");
    if base.len() >= len {
        base
    } else {
        let mut s = String::with_capacity(len);
        s.push_str(&base);
        while s.len() < len {
            s.push('x');
        }
        s
    }
}

fn build_json_rows(rows: usize, cols: usize, str_len: usize) -> Vec<Vec<JsonValue>> {
    let mut out = Vec::with_capacity(rows);
    for r in 0..rows {
        let mut row = Vec::with_capacity(cols);
        for c in 0..cols {
            let v = match c % 6 {
                0 => JsonValue::from(r as i64),
                1 => JsonValue::from((r as f64) * 0.1),
                2 => JsonValue::String(padded_string(r, c, str_len)),
                3 => JsonValue::Bool((r + c) % 2 == 0),
                4 => JsonValue::Null,
                _ => serde_json::json!({ "k": r as i64, "c": c as i64 }),
            };
            row.push(v);
        }
        out.push(row);
    }
    out
}

fn build_cellvalue_rows(
    rows: usize,
    cols: usize,
    str_len: usize,
) -> Vec<Vec<query_pilot::types::CellValue>> {
    use query_pilot::types::CellValue;

    let mut out = Vec::with_capacity(rows);
    for r in 0..rows {
        let mut row = Vec::with_capacity(cols);
        for c in 0..cols {
            let v = match c % 6 {
                0 => CellValue::I64(r as i64),
                1 => CellValue::F64((r as f64) * 0.1),
                2 => CellValue::Text(padded_string(r, c, str_len)),
                3 => CellValue::Bool((r + c) % 2 == 0),
                4 => CellValue::Null,
                _ => CellValue::Json(serde_json::json!({ "k": r as i64, "c": c as i64 })),
            };
            row.push(v);
        }
        out.push(row);
    }
    out
}

fn format_ms(ms: u128) -> String {
    format!("{ms}ms")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let rows: usize = parse_arg(&args, "--rows", 12_546);
    let cols: usize = parse_arg(&args, "--cols", 10);
    let str_len: usize = parse_arg(&args, "--str-len", 24);
    let run_cellvalue = arg_flag(&args, "--cellvalue");

    eprintln!("Dataset: rows={rows} cols={cols} str_len={str_len}");

    // JSON Value path (matches current streaming payload).
    let build_start = Instant::now();
    let json_rows = build_json_rows(rows, cols, str_len);
    let build_ms = build_start.elapsed().as_millis();

    let ser_start = Instant::now();
    let json_bytes = rmp_serde::to_vec(&json_rows).expect("serialize json rows");
    let ser_ms = ser_start.elapsed().as_millis();

    // Pre-allocated write variant (to test whether reallocations matter).
    let prealloc_start = Instant::now();
    let mut prealloc = Vec::with_capacity(json_bytes.len());
    rmp_serde::encode::write(&mut prealloc, &json_rows).expect("encode::write json rows");
    let prealloc_ms = prealloc_start.elapsed().as_millis();

    eprintln!(
        "serde_json::Value: build={} serialize={} encode::write(prealloc)={} bytes={:.2} MiB",
        format_ms(build_ms),
        format_ms(ser_ms),
        format_ms(prealloc_ms),
        json_bytes.len() as f64 / (1024.0 * 1024.0),
    );

    if !run_cellvalue {
        eprintln!("(pass --cellvalue to also test query_pilot::types::CellValue)");
        return;
    }

    // CellValue path (potential future optimization).
    let build_start = Instant::now();
    let cell_rows = build_cellvalue_rows(rows, cols, str_len);
    let build_ms = build_start.elapsed().as_millis();

    let ser_start = Instant::now();
    let cell_bytes = rmp_serde::to_vec(&cell_rows).expect("serialize cellvalue rows");
    let ser_ms = ser_start.elapsed().as_millis();

    let prealloc_start = Instant::now();
    let mut prealloc = Vec::with_capacity(cell_bytes.len());
    rmp_serde::encode::write(&mut prealloc, &cell_rows).expect("encode::write cellvalue rows");
    let prealloc_ms = prealloc_start.elapsed().as_millis();

    eprintln!(
        "CellValue: build={} serialize={} encode::write(prealloc)={} bytes={:.2} MiB",
        format_ms(build_ms),
        format_ms(ser_ms),
        format_ms(prealloc_ms),
        cell_bytes.len() as f64 / (1024.0 * 1024.0),
    );
}
