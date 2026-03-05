function formatExplainFallbackValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    if (typeof value === "symbol") {
      return value.toString();
    }
    return Object.prototype.toString.call(value);
  }
}

export function buildExplainFallbackText(
  columns: string[],
  rows: unknown[][],
): string {
  if (rows.length === 0) {
    return "";
  }

  const normalizedColumns = columns.map((column) => column.toLowerCase().trim());

  // SQLite EXPLAIN QUERY PLAN returns a dedicated "detail" column.
  const detailColumnIndex = normalizedColumns.findIndex((column) =>
    column.endsWith("detail"),
  );
  if (detailColumnIndex >= 0) {
    return rows
      .map((row) => formatExplainFallbackValue(row[detailColumnIndex]))
      .filter((line) => line.length > 0)
      .join("\n");
  }

  // PostgreSQL/other text formats may provide a single textual explain column.
  const explainColumnIndex = normalizedColumns.findIndex(
    (column) => column.includes("query plan") || column.includes("explain"),
  );
  if (explainColumnIndex >= 0) {
    return rows
      .map((row) => formatExplainFallbackValue(row[explainColumnIndex]))
      .filter((line) => line.length > 0)
      .join("\n");
  }

  if (columns.length === 0) {
    return rows
      .map((row) => row.map((cell) => formatExplainFallbackValue(cell)).join(" | "))
      .join("\n");
  }

  // MySQL/MariaDB/SQLite EXPLAIN tabular output: preserve all columns.
  return rows
    .map((row) =>
      columns
        .map(
          (column, index) =>
            `${column}=${formatExplainFallbackValue(row[index])}`,
        )
        .join(" | "),
    )
    .join("\n");
}

