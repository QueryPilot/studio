# SQL Editor Latency Benchmark

Run a quick latency check for SQL completion and linting:

```bash
pnpm bench:sql-editor
```

This command runs:

1. TypeScript completion benchmark (`optimized-completion`) with a deterministic mock metadata provider.
2. Rust lint benchmark (`parse_document + validate_document`) via:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib sql_engine::validator::tests::benchmark_lint_latency -- --ignored --nocapture
```

## Output Fields

- `avg`: average latency per request
- `p50`: median latency
- `p95`: tail latency
- `min` / `max`: range observed in the run

Use these metrics as a regression gate when changing:

- SQL completion logic/caching/ranking
- SQL lint parser/validator rules
- metadata provider fetch paths
