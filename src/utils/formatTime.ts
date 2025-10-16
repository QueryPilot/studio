/**
 * Formats execution time in milliseconds to a human-readable format
 * @param ms - Time in milliseconds
 * @returns Formatted string (e.g., "77388ms" -> "1.29min", "1500ms" -> "1.50s")
 */
export function formatExecutionTime(ms: number | undefined): string {
  if (ms === undefined || ms === null) return "";

  // Less than 1 second: show milliseconds
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  // Less than 1 minute: show seconds with 2 decimal places
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }

  // Less than 1 hour: show minutes with 2 decimal places
  if (ms < 3600000) {
    return `${(ms / 60000).toFixed(2)}min`;
  }

  // 1 hour or more: show hours with 2 decimal places
  return `${(ms / 3600000).toFixed(2)}hr`;
}

/**
 * Formats execution time with detailed breakdown in tooltip
 * @param ms - Time in milliseconds
 * @returns Object with display value and detailed breakdown
 */
export function formatExecutionTimeDetailed(ms: number | undefined): {
  display: string;
  detailed: string;
} {
  if (ms === undefined || ms === null) {
    return { display: "", detailed: "" };
  }

  const display = formatExecutionTime(ms);

  // For tooltip: show original ms value alongside formatted value
  if (ms < 1000) {
    return { display, detailed: display };
  }

  return {
    display,
    detailed: `${display} (${Math.round(ms)}ms)`,
  };
}
