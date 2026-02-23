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
  return /^\d{4}[-/]\d{2}[-/]\d{2}/.test(value);
}

/** Check if a value is numeric (including string-encoded numbers from DB) */
function isNumeric(value: unknown): boolean {
  if (typeof value === "number") return true;
  if (typeof value === "bigint") return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Must be non-empty, not a date, and parseable as a finite number
    return trimmed.length > 0 && !looksLikeDate(trimmed) && isFinite(Number(trimmed));
  }
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

/** Transform query result rows into Recharts-compatible data.
 *  Coerces string-encoded numbers to actual numbers so Recharts
 *  can render correct axis scales and bar/line positions. */
function transformData(
  columns: string[],
  rows: unknown[][],
  numericIndices: Set<number>,
): Record<string, unknown>[] {
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      const val = row[i];
      obj[col] =
        numericIndices.has(i) && typeof val === "string"
          ? Number(val)
          : val;
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
    () =>
      result && analysis
        ? transformData(
            result.columns,
            result.rows,
            new Set(analysis.numericIndices),
          )
        : [],
    [result, analysis],
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

  const categoryKey = result.columns[analysis.categoryIndex] ?? "";
  const numericKeys = analysis.numericIndices.map(
    (i) => result.columns[i] ?? "",
  );

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
                dataKey={numericKeys[0] as string}
                name={numericKeys[0]}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                dataKey={(numericKeys[1] ?? numericKeys[0]) as string}
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
