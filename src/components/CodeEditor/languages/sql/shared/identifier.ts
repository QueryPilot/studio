/**
 * Shared identifier parsing utilities for SQL language support.
 * Handles qualified names (schema.table.column), quote removal, and identifier analysis.
 */

import type { SyntaxNode } from "@lezer/common";

export interface QualifiedInfo {
  qualifier: string;
  name: string;
}

export interface FullyQualifiedName {
  schema?: string;
  table?: string;
  column: string;
}

/**
 * Remove quote characters from SQL identifiers.
 * Handles double quotes, backticks, and square brackets.
 */
export function cleanIdentifier(identifier: string): string {
  return identifier.replace(/["`[\]]/g, "");
}

/**
 * Check if identifier is qualified (table.column pattern).
 * Uses syntax tree sibling analysis for accurate detection.
 */
export function getQualifiedInfo(
  state: { sliceDoc: (from: number, to: number) => string },
  node: {
    from: number;
    to: number;
    prevSibling: {
      name: string;
      from?: number;
      to?: number;
      prevSibling?: { from: number; to: number } | null;
    } | null;
  }
): QualifiedInfo | null {
  const prevSibling = node.prevSibling;

  if (prevSibling?.name === "." && prevSibling.prevSibling) {
    const qualifierNode = prevSibling.prevSibling;
    const qualifier = cleanIdentifier(state.sliceDoc(qualifierNode.from, qualifierNode.to));
    const name = cleanIdentifier(state.sliceDoc(node.from, node.to));
    return { qualifier, name };
  }

  return null;
}

/**
 * Extract fully qualified name from node (handles schema.table.column).
 * Walks backward through dot-separated siblings.
 */
export function getFullyQualifiedName(
  state: { sliceDoc: (from: number, to: number) => string },
  node: SyntaxNode
): FullyQualifiedName {
  const parts: string[] = [];
  let current: SyntaxNode | null = node;

  // Add current node
  parts.unshift(cleanIdentifier(state.sliceDoc(current.from, current.to)));

  // Walk backward through dot-separated identifiers
  while (current?.prevSibling?.name === ".") {
    const prevNode: SyntaxNode | null = current.prevSibling.prevSibling;
    if (prevNode && (prevNode.name === "Identifier" || prevNode.name === "QuotedIdentifier")) {
      parts.unshift(cleanIdentifier(state.sliceDoc(prevNode.from, prevNode.to)));
      current = prevNode;
    } else {
      break;
    }
  }

  // Parse based on number of parts
  if (parts.length === 1) {
    return { column: parts[0]! };
  }
  if (parts.length === 2) {
    return { table: parts[0], column: parts[1]! };
  }
  if (parts.length >= 3) {
    return { schema: parts[0], table: parts[1], column: parts[2]! };
  }

  return { column: parts[0] ?? "" };
}

/**
 * Parse a dot-separated identifier string into parts.
 * E.g., "public.users.id" -> ["public", "users", "id"]
 */
export function parseIdentifierParts(identifier: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < identifier.length; i++) {
    const char = identifier[i]!;

    if (!inQuote && (char === '"' || char === "`" || char === "[")) {
      inQuote = true;
      quoteChar = char === "[" ? "]" : char;
      continue;
    }

    if (inQuote && char === quoteChar) {
      inQuote = false;
      continue;
    }

    if (!inQuote && char === ".") {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

/**
 * Build a qualified identifier string from parts.
 * Handles quoting if necessary.
 */
export function buildQualifiedName(
  parts: string[],
  quoteChar: string = '"'
): string {
  const needsQuoting = (s: string) => /[^a-zA-Z0-9_]/.test(s) || /^[0-9]/.test(s);

  return parts
    .map(p => needsQuoting(p) ? `${quoteChar}${p}${quoteChar}` : p)
    .join(".");
}

/**
 * Check if a string looks like a qualified identifier (contains dots).
 */
export function isQualifiedIdentifier(str: string): boolean {
  return str.includes(".") && !str.startsWith(".") && !str.endsWith(".");
}
