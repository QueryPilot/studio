export interface ColumnStats {
  totalRows: number;
  nullCount: number;
  distinctCount: number;
  // For numeric columns
  min?: number;
  max?: number;
  avg?: number;
  // For string columns
  minLength?: number;
  maxLength?: number;
}

export function calculateColumnStats(
  rows: unknown[][],
  columnIndex: number,
): ColumnStats {
  const values = rows.map((row) => row[columnIndex]);
  const nonNull = values.filter((v) => v !== null && v !== undefined);

  // Use Set for distinct count - JSON.stringify with sorted keys for object comparison
  const distinctSet = new Set(
    nonNull.map((v) => {
      if (typeof v === "object" && v !== null) {
        return JSON.stringify(v, Object.keys(v).sort());
      }
      return JSON.stringify(v);
    }),
  );

  const stats: ColumnStats = {
    totalRows: rows.length,
    nullCount: values.length - nonNull.length,
    distinctCount: distinctSet.size,
  };

  if (nonNull.length === 0) {
    return stats;
  }

  // Check if numeric (all non-null values are numbers)
  const isNumeric = nonNull.every((v) => typeof v === "number");

  if (isNumeric) {
    const nums = nonNull;
    if (nums.length > 0) {
      stats.min = nums.reduce((a, b) => Math.min(a, b), nums[0]!);
      stats.max = nums.reduce((a, b) => Math.max(a, b), nums[0]!);
      stats.avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    }
  } else {
    // For strings, calculate min/max length
    const strings = nonNull.filter((v) => typeof v === "string");
    if (strings.length > 0) {
      const lengths = strings.map((s) => s.length);
      if (lengths.length > 0) {
        stats.minLength = lengths.reduce((a, b) => Math.min(a, b), lengths[0]!);
        stats.maxLength = lengths.reduce((a, b) => Math.max(a, b), lengths[0]!);
      }
    }
  }

  return stats;
}

export function formatNumber(num: number, decimals = 2): string {
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatPercentage(value: number, total: number): string {
  if (total === 0) return "0%";
  const percent = (value / total) * 100;
  return `${percent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}
