# Tier 1 Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the three Tier 1 features from the strategic roadmap: (1) Quick Charts from Query Results, (2) Self-Correcting AI Query Generation, (3) Local AI with Ollama.

**Architecture:** Each feature integrates into existing systems — Charts adds a new view mode to the query result panel, Self-Correcting AI adds an error-feedback loop to the ACP conversation flow, and Ollama adds a new AI provider to the agent discovery system.

**Tech Stack:** React 19, Recharts (new), Zustand, Tauri 2 IPC, Rust, ACP protocol, Ollama HTTP API

---

## Feature 1: Quick Charts from Query Results

### Background

Query results currently support 5 view modes: `table`, `json`, `explain`, `raw`, `stats`. We're adding `chart` as a 6th mode for non-EXPLAIN results (alongside `table` and `json`).

**Key files to understand:**
- `src/stores/tabStateStore.ts:110-133` — `QueryState` interface with `viewMode` type
- `src/components/QueryPanel/QueryPanel.tsx:127-129` — Local `viewMode` state
- `src/components/QueryPanel/QueryToolbar.tsx:53-76` — Toolbar props with `viewMode` type
- `src/components/QueryPanel/ResultViewer.tsx:57-75` — ResultViewer props with `viewMode` type
- `src/components/QueryPanel/ResultViewer.tsx:668-719` — Conditional rendering by `viewMode`
- `src/components/QueryPanel/ExplainViewer.tsx` — Model for how Chart should integrate

**Data shape available:**
```typescript
// From QueryResult in tabStateStore.ts
columns: string[];           // Column names: ["month", "revenue", "count"]
rows: unknown[][];           // 2D values: [["Jan", 50000, 12], ["Feb", 62000, 15]]
columnMeta?: ColumnMeta[];   // Rich type info: { data_type, nullable, db_type, ... }
```

---

### Task 1: Extract ViewMode type and install Recharts

**Files:**
- Create: `src/types/viewMode.ts`
- Modify: `src/stores/tabStateStore.ts:115`
- Modify: `src/components/QueryPanel/QueryPanel.tsx:127-129`
- Modify: `src/components/QueryPanel/QueryToolbar.tsx:58,72-74,134`
- Modify: `src/components/QueryPanel/ResultViewer.tsx:68`

**Why:** The `viewMode` type is duplicated as a string union in 4+ files. Extract it once, add `"chart"`, and all files reference the single source.

**Step 1: Create the shared type**

Create `src/types/viewMode.ts`:
```typescript
export type ViewMode = "table" | "json" | "explain" | "raw" | "stats" | "chart";
```

**Step 2: Update tabStateStore.ts**

In `src/stores/tabStateStore.ts`, replace line 115:
```typescript
// Before:
viewMode: "table" | "json" | "explain" | "raw" | "stats";
// After:
viewMode: ViewMode;
```
Add import: `import type { ViewMode } from "@/types/viewMode";`

**Step 3: Update QueryPanel.tsx**

In `src/components/QueryPanel/QueryPanel.tsx`, replace lines 127-129:
```typescript
// Before:
const [viewMode, setViewModeInternal] = useState<
  "table" | "json" | "explain" | "raw" | "stats"
>(globalState?.viewMode || "table");
// After:
const [viewMode, setViewModeInternal] = useState<ViewMode>(
  globalState?.viewMode || "table",
);
```
Add import: `import type { ViewMode } from "@/types/viewMode";`

Also update `setViewMode` callback (around line 250):
```typescript
// Before:
const setViewMode = useCallback(
  (value: "table" | "json" | "explain" | "raw" | "stats") => {
// After:
const setViewMode = useCallback(
  (value: ViewMode) => {
```

**Step 4: Update QueryToolbar.tsx**

In `src/components/QueryPanel/QueryToolbar.tsx`, update the interface (lines 58, 72-74):
```typescript
// Before:
viewMode: "table" | "json" | "explain" | "raw" | "stats";
// ...
onViewModeChange: (
  mode: "table" | "json" | "explain" | "raw" | "stats",
) => void;
// After:
viewMode: ViewMode;
// ...
onViewModeChange: (mode: ViewMode) => void;
```
Also update the `onValueChange` cast (line 134):
```typescript
// Before:
value as "table" | "json" | "explain" | "raw" | "stats",
// After:
value as ViewMode,
```
Add import: `import type { ViewMode } from "@/types/viewMode";`

**Step 5: Update ResultViewer.tsx**

In `src/components/QueryPanel/ResultViewer.tsx`, update line 68:
```typescript
// Before:
viewMode: "table" | "json" | "explain" | "raw" | "stats";
// After:
viewMode: ViewMode;
```
Add import: `import type { ViewMode } from "@/types/viewMode";`

**Step 6: Install Recharts**

Run: `pnpm add recharts`

**Step 7: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (no type errors — chart mode not rendered yet, just typed)

**Step 8: Commit**

```bash
git add src/types/viewMode.ts src/stores/tabStateStore.ts src/components/QueryPanel/QueryPanel.tsx src/components/QueryPanel/QueryToolbar.tsx src/components/QueryPanel/ResultViewer.tsx pnpm-lock.yaml package.json
git commit -m "refactor: extract ViewMode type, add chart mode, install recharts"
```

---

### Task 2: Create ChartViewer component with auto-detection

**Files:**
- Create: `src/components/QueryPanel/ChartViewer.tsx`
- Test: `src/components/QueryPanel/__tests__/ChartViewer.test.tsx`

**Step 1: Write the test**

Create `src/components/QueryPanel/__tests__/ChartViewer.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChartViewer } from "../ChartViewer";

// Mock recharts to avoid canvas rendering in tests
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="bar-chart" data-rows={data.length} />
  ),
  LineChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="line-chart" data-rows={data.length} />
  ),
  PieChart: () => <div data-testid="pie-chart" />,
  AreaChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="area-chart" data-rows={data.length} />
  ),
  ScatterChart: () => <div data-testid="scatter-chart" />,
  Bar: () => null,
  Line: () => null,
  Pie: () => null,
  Area: () => null,
  Scatter: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Cell: () => null,
}));

describe("ChartViewer", () => {
  const numericResult = {
    columns: ["category", "revenue", "count"],
    rows: [
      ["Electronics", 50000, 120],
      ["Clothing", 35000, 85],
      ["Books", 12000, 200],
    ],
  };

  it("renders a chart when given valid data", () => {
    render(<ChartViewer result={numericResult} />);
    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
  });

  it("shows empty state when result is null", () => {
    render(<ChartViewer result={null} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("shows empty state when rows are empty", () => {
    render(<ChartViewer result={{ columns: ["a"], rows: [] }} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("defaults to bar chart for categorical + numeric data", () => {
    render(<ChartViewer result={numericResult} />);
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("allows switching chart type", async () => {
    render(<ChartViewer result={numericResult} />);
    const user = userEvent.setup();

    // Find and click the line chart option
    const lineButton = screen.getByRole("button", { name: /line/i });
    await user.click(lineButton);

    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });

  it("detects date column and defaults to line chart", () => {
    const dateResult = {
      columns: ["date", "revenue"],
      rows: [
        ["2024-01-01", 50000],
        ["2024-02-01", 62000],
        ["2024-03-01", 58000],
      ],
    };
    render(<ChartViewer result={dateResult} />);
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/QueryPanel/__tests__/ChartViewer.test.tsx`
Expected: FAIL — `ChartViewer` module not found

**Step 3: Implement ChartViewer**

Create `src/components/QueryPanel/ChartViewer.tsx`:
```tsx
import { memo, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";

type ChartType = "bar" | "line" | "pie" | "area" | "scatter";

interface ChartViewerProps {
  result: { columns: string[]; rows: unknown[][] } | null;
}

// Colors for chart series
const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "scatter", label: "Scatter" },
];

/** Check if a value looks like a date string */
function looksLikeDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  // Match ISO dates, YYYY-MM-DD, YYYY/MM/DD patterns
  return /^\d{4}[-/]\d{2}[-/]\d{2}/.test(value);
}

/** Check if a value is numeric */
function isNumeric(value: unknown): boolean {
  if (typeof value === "number") return true;
  if (typeof value === "bigint") return true;
  return false;
}

/** Analyze columns to find category (x-axis) and numeric (y-axis) columns */
function analyzeColumns(
  columns: string[],
  rows: unknown[][],
): {
  categoryIndex: number;
  numericIndices: number[];
  hasDateCategory: boolean;
} {
  if (rows.length === 0) {
    return { categoryIndex: 0, numericIndices: [], hasDateCategory: false };
  }

  // Sample first few rows to detect types
  const sampleRows = rows.slice(0, Math.min(10, rows.length));

  const numericIndices: number[] = [];
  let categoryIndex = 0;
  let hasDateCategory = false;

  for (let i = 0; i < columns.length; i++) {
    const allNumeric = sampleRows.every(
      (row) => row[i] === null || isNumeric(row[i]),
    );
    if (allNumeric) {
      numericIndices.push(i);
    }
  }

  // First non-numeric column is the category
  for (let i = 0; i < columns.length; i++) {
    if (!numericIndices.includes(i)) {
      categoryIndex = i;
      hasDateCategory = sampleRows.some((row) => looksLikeDate(row[i]));
      break;
    }
  }

  // If all columns are numeric, use first as category
  if (numericIndices.length === columns.length && columns.length > 1) {
    categoryIndex = 0;
    numericIndices.shift();
  }

  return { categoryIndex, numericIndices, hasDateCategory };
}

/** Transform query result rows into Recharts-compatible data */
function transformData(
  columns: string[],
  rows: unknown[][],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

export const ChartViewer = memo(function ChartViewer({
  result,
}: ChartViewerProps) {
  const analysis = useMemo(
    () =>
      result && result.rows.length > 0
        ? analyzeColumns(result.columns, result.rows)
        : null,
    [result],
  );

  const defaultChartType: ChartType = analysis?.hasDateCategory
    ? "line"
    : "bar";

  const [chartType, setChartType] = useState<ChartType>(defaultChartType);

  // Reset chart type when data shape changes
  const [prevDefault, setPrevDefault] = useState(defaultChartType);
  if (defaultChartType !== prevDefault) {
    setPrevDefault(defaultChartType);
    setChartType(defaultChartType);
  }

  const chartData = useMemo(
    () => (result ? transformData(result.columns, result.rows) : []),
    [result],
  );

  if (!result || result.rows.length === 0 || !analysis) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No data to chart
      </div>
    );
  }

  if (analysis.numericIndices.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No numeric columns found for charting
      </div>
    );
  }

  const categoryKey = result.columns[analysis.categoryIndex];
  const numericKeys = analysis.numericIndices.map((i) => result.columns[i]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Chart type selector */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b">
        {CHART_TYPES.map((ct) => (
          <button
            key={ct.value}
            role="button"
            aria-label={ct.label}
            onClick={() => setChartType(ct.value)}
            className={cn(
              "px-2 py-0.5 text-xs rounded-md transition-colors",
              chartType === ct.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {ct.label}
          </button>
        ))}
      </div>

      {/* Chart area */}
      <div className="flex-1 min-h-0 p-4">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "bar" ? (
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey={categoryKey} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              {numericKeys.length > 1 && <Legend />}
              {numericKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={COLORS[i % COLORS.length]}
                />
              ))}
            </BarChart>
          ) : chartType === "line" ? (
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey={categoryKey} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              {numericKeys.length > 1 && <Legend />}
              {numericKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          ) : chartType === "area" ? (
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey={categoryKey} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              {numericKeys.length > 1 && <Legend />}
              {numericKeys.map((key, i) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={COLORS[i % COLORS.length]}
                  fill={COLORS[i % COLORS.length]}
                  fillOpacity={0.3}
                />
              ))}
            </AreaChart>
          ) : chartType === "pie" ? (
            <PieChart>
              <Tooltip />
              <Legend />
              <Pie
                data={chartData}
                dataKey={numericKeys[0]}
                nameKey={categoryKey}
                cx="50%"
                cy="50%"
                outerRadius="80%"
                label
              >
                {chartData.map((_, i) => (
                  <Cell
                    key={`cell-${i}`}
                    fill={COLORS[i % COLORS.length]}
                  />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis
                dataKey={numericKeys[0]}
                name={numericKeys[0]}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                dataKey={numericKeys[1] ?? numericKeys[0]}
                name={numericKeys[1] ?? numericKeys[0]}
                tick={{ fontSize: 12 }}
              />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} />
              <Scatter
                name="Data"
                data={chartData}
                fill={COLORS[0]}
              />
            </ScatterChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/QueryPanel/__tests__/ChartViewer.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/QueryPanel/ChartViewer.tsx src/components/QueryPanel/__tests__/ChartViewer.test.tsx
git commit -m "feat: add ChartViewer component with auto-detection and 5 chart types"
```

---

### Task 3: Integrate ChartViewer into the result panel

**Files:**
- Modify: `src/components/QueryPanel/QueryToolbar.tsx:142-160` — Add Chart tab trigger
- Modify: `src/components/QueryPanel/ResultViewer.tsx:668-719` — Add chart rendering branch

**Step 1: Add Chart tab to QueryToolbar**

In `src/components/QueryPanel/QueryToolbar.tsx`, add a Chart tab trigger after the JSON tab (after line 159, before `</>`):

```tsx
{/* Inside the {!isExplainResult && ( block, after JSON TabsTrigger */}
<TabsTrigger
  value="chart"
  className="text-xs !h-5 !px-2"
  tabIndex={2}
>
  Chart
</TabsTrigger>
```

**Step 2: Add chart rendering to ResultViewer**

In `src/components/QueryPanel/ResultViewer.tsx`, add after the json block (after line 719):

```tsx
{viewMode === "chart" && (
  <div className="h-full">
    <ChartViewer
      result={{ columns: result.columns, rows: result.rows }}
    />
  </div>
)}
```

Add import at top:
```typescript
import { ChartViewer } from "./ChartViewer";
```

**Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

Run: `pnpm vitest run src/components/QueryPanel/__tests__/ResultViewer.test.tsx`
Expected: PASS (existing tests unaffected)

**Step 4: Commit**

```bash
git add src/components/QueryPanel/QueryToolbar.tsx src/components/QueryPanel/ResultViewer.tsx
git commit -m "feat: integrate ChartViewer into query result tabs"
```

---

### Task 4: Manual smoke test (Charts)

**Step 1: Start dev server**

Run: `make dev`

**Step 2: Test with a real query**

1. Connect to a database
2. Run: `SELECT 'Electronics' as category, 50000 as revenue UNION ALL SELECT 'Clothing', 35000 UNION ALL SELECT 'Books', 12000`
3. Click the "Chart" tab in results
4. Verify bar chart renders with 3 bars
5. Click "Line" — verify line chart renders
6. Click "Pie" — verify pie chart renders
7. Run an EXPLAIN query — verify Chart tab does NOT appear
8. Run a query with no numeric columns — verify "No numeric columns" message

**Step 3: Commit any fixes if needed**

---

## Feature 2: Self-Correcting AI Query Generation

### Background

Currently when AI generates SQL and the user clicks "Run", errors are shown in the QueryPanel but NOT fed back to the AI conversation. The self-correction loop will:

1. Detect query execution errors from AI-generated SQL
2. Automatically send the error back to the AI conversation
3. Let the AI generate a corrected query
4. Show each attempt in the chat with an attempt counter
5. Respect Safe Mode: auto-retry only for read-only statements

**Key files to understand:**
- `src/components/AI/AIPanel.tsx` — Main AI chat component (1,989 lines)
- `src/components/AI/QueryBlock.tsx` — Renders SQL blocks with Run button
- `src/services/aiCommandExecutor.ts` — Executes AI commands (query.run, etc.)
- `src/stores/acpStore.ts` — ACP state management
- `src/services/tableStreamingService.ts` — Query execution service

**Current query execution flow from AI:**
```
User clicks Run on QueryBlock
  → AIPanel.handleQueryRun(query, connectionId)
  → tableStreamingService.streamQuery()
  → Result/error shown in QueryPanel
  → Error is NOT sent back to AI conversation
```

---

### Task 5: Add self-correction utility and tests

**Files:**
- Create: `src/utils/selfCorrection.ts`
- Create: `src/utils/__tests__/selfCorrection.test.ts`

**Step 1: Write the test**

Create `src/utils/__tests__/selfCorrection.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  isReadOnlyStatement,
  buildCorrectionPrompt,
  MAX_CORRECTION_ATTEMPTS,
} from "../selfCorrection";

describe("selfCorrection", () => {
  describe("isReadOnlyStatement", () => {
    it("returns true for SELECT", () => {
      expect(isReadOnlyStatement("SELECT * FROM users")).toBe(true);
    });

    it("returns true for EXPLAIN", () => {
      expect(isReadOnlyStatement("EXPLAIN SELECT * FROM users")).toBe(true);
    });

    it("returns true for WITH (CTE)", () => {
      expect(
        isReadOnlyStatement("WITH cte AS (SELECT 1) SELECT * FROM cte"),
      ).toBe(true);
    });

    it("returns true for SHOW", () => {
      expect(isReadOnlyStatement("SHOW TABLES")).toBe(true);
    });

    it("returns false for INSERT", () => {
      expect(
        isReadOnlyStatement("INSERT INTO users (name) VALUES ('a')"),
      ).toBe(false);
    });

    it("returns false for UPDATE", () => {
      expect(
        isReadOnlyStatement("UPDATE users SET name = 'b' WHERE id = 1"),
      ).toBe(false);
    });

    it("returns false for DELETE", () => {
      expect(isReadOnlyStatement("DELETE FROM users WHERE id = 1")).toBe(false);
    });

    it("returns false for DROP", () => {
      expect(isReadOnlyStatement("DROP TABLE users")).toBe(false);
    });

    it("returns false for CREATE", () => {
      expect(
        isReadOnlyStatement("CREATE TABLE users (id INT)"),
      ).toBe(false);
    });

    it("handles leading whitespace and comments", () => {
      expect(isReadOnlyStatement("  \n  SELECT 1")).toBe(true);
      expect(isReadOnlyStatement("-- comment\nSELECT 1")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(isReadOnlyStatement("select * from users")).toBe(true);
      expect(isReadOnlyStatement("Select * From users")).toBe(true);
    });
  });

  describe("buildCorrectionPrompt", () => {
    it("includes the original query", () => {
      const prompt = buildCorrectionPrompt("SELECT * FORM users", "syntax error", 1);
      expect(prompt).toContain("SELECT * FORM users");
    });

    it("includes the error message", () => {
      const prompt = buildCorrectionPrompt("SELECT * FORM users", "syntax error near FORM", 1);
      expect(prompt).toContain("syntax error near FORM");
    });

    it("includes the attempt number", () => {
      const prompt = buildCorrectionPrompt("SELECT 1", "error", 2);
      expect(prompt).toContain("attempt 2");
    });
  });

  describe("MAX_CORRECTION_ATTEMPTS", () => {
    it("is 3", () => {
      expect(MAX_CORRECTION_ATTEMPTS).toBe(3);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/utils/__tests__/selfCorrection.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the utility**

Create `src/utils/selfCorrection.ts`:
```typescript
export const MAX_CORRECTION_ATTEMPTS = 3;

const READ_ONLY_PREFIXES = [
  "SELECT",
  "EXPLAIN",
  "WITH",
  "SHOW",
  "DESCRIBE",
  "DESC",
];

/**
 * Check if a SQL statement is read-only (safe for auto-retry).
 * Strips leading whitespace and SQL comments before checking.
 */
export function isReadOnlyStatement(sql: string): boolean {
  // Strip leading whitespace and single-line comments
  const stripped = sql
    .replace(/^[\s\n\r]+/, "")
    .replace(/^--[^\n]*\n/gm, "")
    .replace(/^[\s\n\r]+/, "")
    .toUpperCase();

  return READ_ONLY_PREFIXES.some((prefix) =>
    stripped.startsWith(prefix),
  );
}

/**
 * Build a correction prompt to send back to the AI after a query error.
 */
export function buildCorrectionPrompt(
  originalQuery: string,
  errorMessage: string,
  attemptNumber: number,
): string {
  return [
    `The query I ran failed (attempt ${attemptNumber} of ${MAX_CORRECTION_ATTEMPTS}). Please fix it.`,
    "",
    "**Query that failed:**",
    "```sql",
    originalQuery,
    "```",
    "",
    "**Error:**",
    "```",
    errorMessage,
    "```",
    "",
    "Please provide a corrected query. Only output the SQL in a code block, no explanation needed.",
  ].join("\n");
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/utils/__tests__/selfCorrection.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/selfCorrection.ts src/utils/__tests__/selfCorrection.test.ts
git commit -m "feat: add self-correction utility for AI query generation"
```

---

### Task 6: Integrate self-correction into AIPanel query execution

**Files:**
- Modify: `src/components/AI/AIPanel.tsx` — Add error-feedback loop to `handleQueryRun`
- Modify: `src/components/AI/QueryBlock.tsx` — Add correction attempt indicator

**Important context:** The `handleQueryRun` function in AIPanel.tsx executes AI-generated SQL. Currently it creates a tab and runs the query, but doesn't feed errors back. We need to:

1. After `tableStreamingService.streamQuery()` completes with an error
2. Check if the statement is read-only (safe for auto-retry)
3. If yes, send the error back to the AI conversation via `acpStore.sendMessage()`
4. Track attempt count per query block

**Step 1: Find and read the current handleQueryRun**

Read `src/components/AI/AIPanel.tsx` and find the `handleQueryRun` function. Understand how it calls `tableStreamingService` and how errors are currently handled.

**Step 2: Add self-correction integration**

This is a complex integration. The key changes:

1. In AIPanel, after a query from QueryBlock fails, check `isReadOnlyStatement(query)`.
2. If read-only AND attempts < MAX_CORRECTION_ATTEMPTS, call `acpStore.sendMessage()` with `buildCorrectionPrompt()`.
3. Add a `correctionAttempts` ref/state to track per-message attempts.
4. In QueryBlock, show attempt badge: "Attempt 2/3" when corrections are happening.

**Implementation approach:** Add a `handleQueryError` callback that QueryBlock or the execution path calls when a query fails. This callback:
- Checks if auto-correction is appropriate (read-only, under attempt limit)
- Sends correction prompt to AI
- The AI's response will contain a new QueryBlock, which the user can run again

**Note:** The exact implementation depends on the current structure of `handleQueryRun` and how `tableStreamingService` reports errors. The implementing engineer should read `AIPanel.tsx` fully before coding.

**Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/AI/AIPanel.tsx src/components/AI/QueryBlock.tsx
git commit -m "feat: integrate self-correcting AI loop for read-only queries"
```

---

### Task 7: Manual smoke test (Self-Correcting AI)

**Step 1: Start dev server**

Run: `make dev`

**Step 2: Test self-correction flow**

1. Open AI panel, connect to a database
2. Ask: "Show me all users from the last 30 days" (assuming no `users` table)
3. AI generates SQL → click Run → query fails (table doesn't exist)
4. Verify: Error is automatically sent back to AI conversation
5. AI generates corrected query
6. Verify: Attempt counter shows "Attempt 2/3"
7. If still fails, verify it retries up to 3 times then stops

**Step 3: Test safety gates**

1. Ask AI to "Delete all records from [table]"
2. AI generates DELETE statement → click Run → verify NO auto-correction (mutating statement)
3. Error just shows in QueryPanel as before

---

## Feature 3: Local AI with Ollama

### Background

Query Pilot's AI uses the ACP (Agent Client Protocol) to communicate with external agents (Claude Code, Gemini, etc.) as subprocesses. Ollama integration adds a new AI provider that communicates via Ollama's HTTP API instead of subprocess stdio.

**Key files to understand:**
- `src-tauri/src/acp/discovery.rs` — Agent discovery (auto-detects installed agents)
- `src-tauri/src/acp/manager.rs` — Agent lifecycle management
- `src-tauri/src/acp/commands.rs` — Tauri IPC commands for AI
- `src/stores/acpStore.ts` — Frontend AI state
- `src/components/AI/AIPanel.tsx` — AI chat UI

**Current agent flow:**
```
discovery.rs scans for agents → lists: claude, gemini, opencode, codex, goose
user selects agent → acp_start_agent() spawns subprocess
acp_create_session() → session with MCP sidecar attached
acp_send_prompt() → sends prompt via stdio → streams response events
```

**Ollama approach:** Rather than spawning a subprocess, Ollama uses HTTP API calls to `localhost:11434`. This requires a different communication path from the subprocess-based ACP agents.

---

### Task 8: Research Ollama API and design integration

**Files:**
- Read: Ollama API docs at `https://github.com/ollama/ollama/blob/main/docs/api.md`

**Step 1: Understand the Ollama API**

Key endpoints:
- `GET /api/tags` — List available models
- `POST /api/chat` — Chat completion (streaming)
- `POST /api/generate` — Text generation (streaming)

Chat request format:
```json
{
  "model": "qwen2.5-coder:7b",
  "messages": [
    { "role": "system", "content": "You are a SQL expert..." },
    { "role": "user", "content": "Show me all orders..." }
  ],
  "stream": true
}
```

Streaming response (each line is a JSON object):
```json
{"model":"qwen2.5-coder:7b","message":{"role":"assistant","content":"```sql\nSELECT"},"done":false}
{"model":"qwen2.5-coder:7b","message":{"role":"assistant","content":" *"},"done":false}
{"model":"qwen2.5-coder:7b","message":{"role":"assistant","content":""},"done":true}
```

**Step 2: Design the integration point**

Two approaches:
1. **Add Ollama as a Rust-side HTTP client** in `src-tauri/src/acp/` — treat it as a special agent type that uses HTTP instead of subprocess stdio
2. **Add Ollama as a frontend-side provider** — bypass ACP entirely, call Ollama API from the frontend via Tauri's HTTP client

**Recommended: Option 1** — keeps all AI communication in the Rust backend, consistent with existing architecture, and can reuse the session event streaming system.

**Step 3: Document the design**

The implementing engineer should:
1. Add `ollama` agent type to `discovery.rs` — detected by checking if `localhost:11434` responds
2. Add `OllamaClient` in a new `src-tauri/src/acp/ollama.rs` — HTTP client using `reqwest`
3. In `manager.rs`, when agent type is `ollama`, use `OllamaClient` instead of subprocess
4. Build system prompt with schema context (same format as other agents)
5. Stream response chunks as `SessionUpdateEvent::AgentMessageChunk`
6. The frontend needs zero changes — it already handles streaming message chunks

---

### Task 9: Add Ollama agent discovery

**Files:**
- Modify: `src-tauri/src/acp/discovery.rs` — Add Ollama detection
- Create: `src-tauri/src/acp/ollama.rs` — Ollama HTTP client
- Modify: `src-tauri/src/acp/mod.rs` — Export ollama module

**Step 1: Read current discovery.rs**

Read `src-tauri/src/acp/discovery.rs` to understand how agents are discovered and listed. Each agent has: `id`, `name`, `description`, `executable_path`, `supported_models`, etc.

**Step 2: Add Ollama detection**

Add a function that checks if Ollama is running by hitting `http://localhost:11434/api/tags`. If it responds, add an `ollama` agent to the discovery list.

```rust
// In discovery.rs
async fn detect_ollama() -> Option<AgentInfo> {
    let client = reqwest::Client::new();
    let resp = client
        .get("http://localhost:11434/api/tags")
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .ok()?;

    if resp.status().is_success() {
        Some(AgentInfo {
            id: "ollama".to_string(),
            name: "Ollama (Local)".to_string(),
            description: "Local AI models via Ollama - private, no cloud required".to_string(),
            // ... fill in fields based on existing pattern
        })
    } else {
        None
    }
}
```

**Step 3: Add model listing**

Implement `acp_fetch_agent_models` for Ollama — parse the `/api/tags` response to list available models.

**Step 4: Verify**

Run: `cd src-tauri && cargo clippy`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/acp/discovery.rs src-tauri/src/acp/ollama.rs src-tauri/src/acp/mod.rs
git commit -m "feat: add Ollama agent discovery and model listing"
```

---

### Task 10: Implement Ollama chat client

**Files:**
- Modify: `src-tauri/src/acp/ollama.rs` — Add chat completion with streaming
- Modify: `src-tauri/src/acp/manager.rs` — Route Ollama sessions through HTTP client

**Step 1: Implement OllamaClient**

```rust
// In ollama.rs
pub struct OllamaClient {
    base_url: String,
    client: reqwest::Client,
}

impl OllamaClient {
    pub fn new(base_url: &str) -> Self { /* ... */ }

    /// Send a chat message and stream the response
    pub async fn chat_stream(
        &self,
        model: &str,
        messages: Vec<ChatMessage>,
        tx: mpsc::Sender<SessionNotification>,
    ) -> Result<(), anyhow::Error> {
        let resp = self.client
            .post(format!("{}/api/chat", self.base_url))
            .json(&serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true
            }))
            .send()
            .await?;

        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            // Parse JSON line, extract content delta
            // Send as SessionNotification::AgentMessageChunk
        }
        Ok(())
    }
}
```

**Step 2: Build system prompt with schema context**

Create a function that builds the Ollama system prompt including:
- Role: "You are a SQL expert..."
- Current database type and connection info
- Relevant schema (tables, columns, types)
- Instructions for output format (SQL in code blocks)

**Step 3: Route in manager.rs**

In `acp_send_prompt`, check if the agent is Ollama. If so, route through `OllamaClient` instead of subprocess stdio.

**Step 4: Verify**

Run: `cd src-tauri && cargo clippy`
Expected: PASS

Run: `cd src-tauri && cargo test ollama` (if you wrote unit tests)
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/acp/ollama.rs src-tauri/src/acp/manager.rs
git commit -m "feat: implement Ollama chat client with streaming"
```

---

### Task 11: Add Ollama settings UI

**Files:**
- Create: `src/components/AI/OllamaSettings.tsx` — Settings panel for Ollama endpoint + model
- Modify: `src/stores/acpStore.ts` — Add Ollama configuration state

**Step 1: Add Ollama config to acpStore**

In `src/stores/acpStore.ts`, add:
```typescript
ollamaConfig: {
  baseUrl: string;  // default: "http://localhost:11434"
  enabled: boolean; // default: false
};
setOllamaConfig: (config: Partial<OllamaConfig>) => void;
```

**Step 2: Create OllamaSettings component**

Simple settings form with:
- Endpoint URL input (default: `http://localhost:11434`)
- "Test Connection" button — calls `/api/tags` and shows success/failure
- Model dropdown — populated from `/api/tags` response
- Enable/disable toggle

**Step 3: Integrate into existing settings**

Add OllamaSettings to the AI settings section (find where agent selection happens in the UI).

**Step 4: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/AI/OllamaSettings.tsx src/stores/acpStore.ts
git commit -m "feat: add Ollama settings UI with connection test"
```

---

### Task 12: Manual smoke test (Ollama)

**Prerequisites:** Install Ollama locally with `brew install ollama` and pull a model: `ollama pull qwen2.5-coder:7b`

**Step 1: Start dev server**

Run: `make dev`

**Step 2: Test Ollama integration**

1. Open AI panel settings
2. Verify Ollama appears as an agent option (if running)
3. Select Ollama agent
4. Select a model from the dropdown
5. Ask: "Show me all tables in the database"
6. Verify streaming response with SQL code block
7. Click Run on the generated SQL
8. Verify query executes successfully

**Step 3: Test graceful fallback**

1. Stop Ollama: `ollama stop`
2. Open AI panel
3. Verify clear message: "Ollama is not running" with install/start instructions
4. Start Ollama again: `ollama serve`
5. Verify agent becomes available again

---

### Task 13: Final verification

**Step 1: Run all tests**

Run: `pnpm test:unit`
Expected: All tests pass

**Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 3: Run backend checks**

Run: `cd src-tauri && cargo clippy && cargo fmt -- --check`
Expected: PASS

**Step 4: Final commit if any cleanup needed**

---

## Summary

| Task | Feature | Estimated Complexity |
|------|---------|---------------------|
| 1 | Charts: Extract ViewMode type + install Recharts | Small |
| 2 | Charts: Create ChartViewer component | Medium |
| 3 | Charts: Integrate into result panel | Small |
| 4 | Charts: Smoke test | Manual |
| 5 | Self-Correction: Utility + tests | Small |
| 6 | Self-Correction: AIPanel integration | Medium-Large |
| 7 | Self-Correction: Smoke test | Manual |
| 8 | Ollama: Research + design | Research |
| 9 | Ollama: Agent discovery | Medium |
| 10 | Ollama: Chat client with streaming | Medium-Large |
| 11 | Ollama: Settings UI | Medium |
| 12 | Ollama: Smoke test | Manual |
| 13 | Final verification | Small |
