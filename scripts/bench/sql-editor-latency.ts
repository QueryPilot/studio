#!/usr/bin/env tsx

import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import {
  clearCompletionCache,
  createOptimizedCompletionSource,
} from "../../src/components/CodeEditor/languages/sql/optimized-completion";
import type { MetadataProvider } from "../../src/components/CodeEditor/types";

type Scenario = {
  name: string;
  sqlWithCursor: string;
};

type Stats = {
  iterations: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
};

const CONNECTION_ID = "bench-conn";
const DIALECT = "postgresql";
const SCHEMA = "public";
const DB = "benchdb";

function computeStats(samples: number[]): Stats {
  if (samples.length === 0) {
    throw new Error("Cannot compute stats for empty sample set");
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("Failed to compute benchmark bounds");
  }

  const avgMs = sorted.reduce((acc, n) => acc + n, 0) / sorted.length;
  const p50Ms = sorted[Math.floor(sorted.length * 0.5)] ?? first;
  const p95Ms = sorted[Math.floor(sorted.length * 0.95)] ?? last;

  return {
    iterations: sorted.length,
    avgMs,
    p50Ms,
    p95Ms,
    minMs: first,
    maxMs: last,
  };
}

function fmtMs(value: number): string {
  return value.toFixed(3);
}

function parseCursor(sqlWithCursor: string): { sql: string; pos: number } {
  const marker = "|";
  const pos = sqlWithCursor.indexOf(marker);
  if (pos === -1) {
    throw new Error(`Missing cursor marker '|' in scenario: ${sqlWithCursor}`);
  }

  return {
    sql: `${sqlWithCursor.slice(0, pos)}${sqlWithCursor.slice(pos + marker.length)}`,
    pos,
  };
}

function buildMockProvider(): MetadataProvider {
  const entities = [
    { name: "users", type: "table" as const, schema: SCHEMA },
    { name: "orders", type: "table" as const, schema: SCHEMA },
    { name: "order_items", type: "table" as const, schema: SCHEMA },
    { name: "products", type: "table" as const, schema: SCHEMA },
    { name: "customers", type: "table" as const, schema: SCHEMA },
  ];

  const columns: Record<string, Array<{ name: string; dataType: string }>> = {
    users: [
      { name: "id", dataType: "int8" },
      { name: "email", dataType: "text" },
      { name: "name", dataType: "text" },
      { name: "created_at", dataType: "timestamptz" },
    ],
    orders: [
      { name: "id", dataType: "int8" },
      { name: "user_id", dataType: "int8" },
      { name: "total", dataType: "numeric" },
      { name: "status", dataType: "text" },
      { name: "created_at", dataType: "timestamptz" },
    ],
    order_items: [
      { name: "id", dataType: "int8" },
      { name: "order_id", dataType: "int8" },
      { name: "product_id", dataType: "int8" },
      { name: "qty", dataType: "int4" },
      { name: "price", dataType: "numeric" },
    ],
    products: [
      { name: "id", dataType: "int8" },
      { name: "sku", dataType: "text" },
      { name: "title", dataType: "text" },
      { name: "price", dataType: "numeric" },
    ],
    customers: [
      { name: "id", dataType: "int8" },
      { name: "email", dataType: "text" },
      { name: "full_name", dataType: "text" },
    ],
  };

  return {
    listEntities() {
      return Promise.resolve(entities);
    },
    listFields(entityName: string) {
      return Promise.resolve(
        (columns[entityName] || []).map((col) => ({
          name: col.name,
          dataType: col.dataType,
          parentEntity: entityName,
        })),
      );
    },
    listFunctions() {
      return Promise.resolve([
        {
          name: "count",
          returnType: "bigint",
          arguments: "expression any",
        },
        {
          name: "coalesce",
          returnType: "any",
          arguments: "value any, ...",
        },
      ]);
    },
  };
}

async function runCompletionBench(): Promise<{
  warm: Stats;
  cold: Stats;
}> {
  const provider = buildMockProvider();
  const source = createOptimizedCompletionSource({
    connectionId: CONNECTION_ID,
    database: DB,
    schema: SCHEMA,
    dialect: DIALECT,
    providerOverride: provider,
    disableRustSource: true,
  });

  const scenarios: Scenario[] = [
    {
      name: "table-name",
      sqlWithCursor: "SELECT * FROM |",
    },
    {
      name: "qualified-column",
      sqlWithCursor: "SELECT u.| FROM users u",
    },
    {
      name: "join-qualified-column",
      sqlWithCursor:
        "SELECT u.email, o.total FROM users u JOIN orders o ON u.id = o.user_id WHERE o.|",
    },
  ];

  const cases = scenarios.map((scenario) => {
    const parsed = parseCursor(scenario.sqlWithCursor);
    return {
      name: scenario.name,
      state: EditorState.create({ doc: parsed.sql }),
      pos: parsed.pos,
    };
  });

  const run = async (iterations: number, warmup: number, cold: boolean) => {
    const samples: number[] = [];
    if (cases.length === 0) {
      throw new Error("No completion benchmark scenarios configured");
    }

    for (let i = 0; i < warmup + iterations; i++) {
      const c = cases[i % cases.length];
      if (!c) {
        throw new Error("Scenario resolution failed");
      }
      if (cold) {
        clearCompletionCache(CONNECTION_ID);
      }

      const ctx = new CompletionContext(c.state, c.pos, true);
      const started = performance.now();
      const result = await source(ctx);
      const elapsed = performance.now() - started;

      if (!result || result.options.length === 0) {
        throw new Error(`No completion results for scenario '${c.name}'`);
      }

      if (i >= warmup) {
        samples.push(elapsed);
      }
    }

    return computeStats(samples);
  };

  clearCompletionCache(CONNECTION_ID);
  const warm = await run(240, 20, false);

  clearCompletionCache(CONNECTION_ID);
  const cold = await run(120, 10, true);

  return { warm, cold };
}

function runLintBenchFromRust(): Stats {
  const args = [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--lib",
    "sql_engine::validator::tests::benchmark_lint_latency",
    "--",
    "--ignored",
    "--nocapture",
  ];

  const result = spawnSync("cargo", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    throw new Error(`Rust lint benchmark failed:\n${output}`);
  }

  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/BENCH_LINT\s+(\{[^\n]+\})/);
  if (!match?.[1]) {
    throw new Error("Unable to parse BENCH_LINT output from Rust benchmark");
  }

  const parsed = JSON.parse(match[1]) as {
    iterations: number;
    avg_ms: number;
    p50_ms: number;
    p95_ms: number;
    min_ms: number;
    max_ms: number;
  };

  return {
    iterations: parsed.iterations,
    avgMs: parsed.avg_ms,
    p50Ms: parsed.p50_ms,
    p95Ms: parsed.p95_ms,
    minMs: parsed.min_ms,
    maxMs: parsed.max_ms,
  };
}

function printStats(label: string, stats: Stats): void {
  console.log(
    `${label}: n=${stats.iterations}, avg=${fmtMs(stats.avgMs)}ms, p50=${fmtMs(stats.p50Ms)}ms, p95=${fmtMs(stats.p95Ms)}ms, min=${fmtMs(stats.minMs)}ms, max=${fmtMs(stats.maxMs)}ms`,
  );
}

async function main(): Promise<void> {
  console.log("SQL editor latency benchmark");
  console.log("----------------------------------------");

  const completion = await runCompletionBench();
  printStats("completion (warm)", completion.warm);
  printStats("completion (cold)", completion.cold);

  const lint = runLintBenchFromRust();
  printStats("lint (rust)", lint);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
