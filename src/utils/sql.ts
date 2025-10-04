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
  // Remove redundant outer parentheses (common PG style)
  for (let i = 0; i < 3; i++) {
    if (s.startsWith("(") && s.endsWith(")")) {
      s = s.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return s;
}
