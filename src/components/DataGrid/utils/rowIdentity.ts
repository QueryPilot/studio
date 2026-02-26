import { ConstraintType } from "@/services/backend";
import type { Constraint, Index } from "@/types/tableStructure";

interface DeterministicIdentityInput {
  primaryKeys?: string[];
  constraints?: Constraint[];
  indexes?: Index[];
}

const IDENTIFIER_TRIM_RE = /^[\s`"\[]+|[\s`"\]]+$/g;

function normalizeIdentifier(raw: string): string | null {
  const value = raw.trim().replace(IDENTIFIER_TRIM_RE, "");
  if (!value) return null;
  if (value.includes("(") || value.includes(")")) return null;
  // Reject expressions/operator suffixes; keep simple column names only.
  if (/\s/.test(value)) return null;
  return value;
}

function splitTopLevelList(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: '"' | "'" | null = null;

  for (const ch of input) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === "(") {
      depth += 1;
      current += ch;
      continue;
    }

    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }

    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseUniqueConstraintColumns(definition: string): string[] {
  const match = definition.match(/UNIQUE\s*\((.*)\)/i);
  if (!match || !match[1]) return [];

  const rawColumns = splitTopLevelList(match[1]);
  const columns: string[] = [];

  for (const raw of rawColumns) {
    const normalized = normalizeIdentifier(raw);
    if (!normalized) return [];
    columns.push(normalized);
  }

  return columns;
}

function isUniqueConstraintType(value: Constraint["constraint_type"]): boolean {
  return value === ConstraintType.Unique || String(value) === ConstraintType.Unique;
}

function normalizeNonEmptyColumns(columns: string[] | undefined): string[] {
  if (!columns) return [];

  const result: string[] = [];
  for (const column of columns) {
    const normalized = normalizeIdentifier(column);
    if (!normalized) continue;
    result.push(normalized);
  }

  return result;
}

export function chooseDeterministicIdentityColumns(
  input: DeterministicIdentityInput,
): string[] | null {
  const primaryKeys = normalizeNonEmptyColumns(input.primaryKeys);
  if (primaryKeys.length > 0) {
    return primaryKeys;
  }

  for (const constraint of input.constraints ?? []) {
    if (!isUniqueConstraintType(constraint.constraint_type)) continue;
    const columns = parseUniqueConstraintColumns(constraint.definition ?? "");
    if (columns.length > 0) {
      return columns;
    }
  }

  for (const index of input.indexes ?? []) {
    if (!index.is_unique || index.is_partial) continue;
    const columns = normalizeNonEmptyColumns(index.columns);
    if (columns.length > 0) {
      return columns;
    }
  }

  return null;
}
