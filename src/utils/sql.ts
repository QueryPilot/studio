/**
 * Normalize a DEFAULT value for SQL based on the column's database type.
 *
 * - Quotes bare identifiers for text-like types so they are treated as string literals
 * - Preserves known keywords/functions (CURRENT_TIMESTAMP, now(), true/false, numbers)
 * - Returns null for explicit NULL, allowing callers to interpret as no default/drop
 *
 * @param value The raw default value from UI (string or null)
 * @param dbType The database type name (e.g., text, varchar, int4)
 * @returns Normalized default string or null when explicitly NULL
 */
export function normalizeDefaultForType(
  value?: string | null,
  dbType?: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  // Normalize explicit NULL
  if (trimmed.toUpperCase() === "NULL") return null;

  const baseType = (dbType || "").toLowerCase();
  const isTextLike =
    baseType === "text" ||
    baseType === "varchar" ||
    baseType === "char" ||
    baseType === "bpchar" ||
    baseType === "citext";

  // If already quoted or clearly an expression/call/cast, leave as is
  if (
    trimmed.startsWith("'") ||
    trimmed.startsWith('"') ||
    /\(|::|\[|\]|\{|\}|\.|\s/.test(trimmed)
  ) {
    return trimmed;
  }

  // Preserve numerics and booleans
  if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase();

  // Preserve common time keywords
  const KEYWORDS = new Set([
    "CURRENT_TIMESTAMP",
    "CURRENT_DATE",
    "CURRENT_TIME",
  ]);
  if (KEYWORDS.has(trimmed.toUpperCase())) return trimmed.toUpperCase();

  // For text-like (and unknown) types, quote bare identifiers to avoid
  // accidental column-reference errors in DEFAULT expressions.
  if (isTextLike || baseType === "") {
    const escaped = trimmed.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  // Otherwise return as-is
  return trimmed;
}

/**
 * Extracts the boolean expression from a CHECK constraint definition
 * returned by the database (e.g., 'CHECK (((a > 0) AND (a < 10)))').
 * Returns only the inner condition: 'a > 0 AND a < 10'.
 */
export function extractCheckCondition(definition: string): string {
  if (!definition) return "";
  let s = definition.trim();
  // Strip leading CHECK (...) wrapper if present
  const m = s.match(/^CHECK\s*\(([\s\S]*)\)$/i);
  if (m && m[1] !== undefined) s = m[1].trim();
  // Remove only truly wrapping outer parentheses, repeatedly
  const stripOnceIfWrapped = (text: string): string | null => {
    if (!text.startsWith("(") || !text.endsWith(")")) return null;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      // If we reached depth 0 before the last char, outer parens don't wrap all
      if (depth === 0 && i < text.length - 1) return null;
    }
    // If we ended exactly at depth 0 on the last char, outer parens wrap all
    return text.slice(1, -1).trim();
  };

  // Keep stripping while outer parentheses truly wrap the entire expression
  while (true) {
    const stripped = stripOnceIfWrapped(s);
    if (stripped == null) break;
    s = stripped;
  }
  return s;
}
