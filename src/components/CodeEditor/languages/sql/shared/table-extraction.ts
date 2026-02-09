/**
 * Shared table extraction utilities for SQL language support.
 * Consolidates table reference extraction from context.ts and optimized-completion.ts.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { isSqlKeyword, isTableKeyword, TABLE_KEYWORDS_SET } from "../constants";
import { getInstanceCache, hashDocument, hashString, CACHE_CONFIG } from "./cache";

export interface TableRef {
  schema?: string;
  name: string;
  alias?: string;
  isCTE?: boolean;
  cteColumns?: string[];
  cteSourceTable?: string;
}

// Node types that indicate table clause context
// Must match both statement-level and clause-level AST nodes
const TABLE_CLAUSE_TYPES = [
  "FromClause",
  "JoinExpression",
  "TableExpression",
  "IntoClause",
  "UpdateClause",
  "UpdateStatement",
  "InsertStatement",
  "DeleteStatement",
];

function sanitizeAlias(raw: string): string {
  return raw.replace(/["`[\]]/g, "");
}

function isValidAlias(alias: string | undefined): alias is string {
  if (!alias) return false;
  const normalized = sanitizeAlias(alias).trim();
  if (!normalized) return false;
  if (isSqlKeyword(normalized)) return false;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized);
}

/**
 * Extract table references from a syntax tree within a specific range.
 * Core extraction logic used by both full-document and scoped extraction.
 */
export function extractTablesFromRange(
  state: EditorState,
  from: number,
  to: number,
  seen: Set<string> = new Set()
): TableRef[] {
  const tables: TableRef[] = [];
  const tree = syntaxTree(state);
  const cursor = tree.cursor();

  while (cursor.next()) {
    if (cursor.to < from || cursor.from > to) continue;

    if (cursor.name === "Identifier" || cursor.name === "QuotedIdentifier") {
      const parent = cursor.node.parent;
      const prevSibling = cursor.node.prevSibling;

      const isInTableClause = parent && TABLE_CLAUSE_TYPES.includes(parent.type.name);
      const followsTableKeyword =
        prevSibling?.type.name === "Keyword" &&
        isTableKeyword(state.sliceDoc(prevSibling.from, prevSibling.to));

      if (isInTableClause || followsTableKeyword) {
        const tableName = state.sliceDoc(cursor.from, cursor.to).replace(/["`[\]]/g, "");

        if (seen.has(tableName.toLowerCase())) continue;

        // Extract alias
        const alias = extractAlias(state, cursor.node);

        // Extract schema (schema.table notation)
        let schema: string | undefined;
        if (prevSibling?.type.name === "." && prevSibling.prevSibling) {
          schema = state
            .sliceDoc(prevSibling.prevSibling.from, prevSibling.prevSibling.to)
            .replace(/["`[\]]/g, "");
        }

        tables.push({ schema, name: tableName, alias });
        seen.add(tableName.toLowerCase());
        if (alias) seen.add(alias.toLowerCase());
      }
    }
  }

  return tables;
}

/**
 * Extract alias from node's next sibling, handling optional AS keyword.
 */
function extractAlias(state: EditorState, node: SyntaxNode): string | undefined {
  let nextNode = node.nextSibling;

  // Skip AS keyword if present
  if (nextNode?.type.name === "Keyword") {
    const kw = state.sliceDoc(nextNode.from, nextNode.to).toLowerCase();
    if (kw === "as") {
      nextNode = nextNode.nextSibling;
    }
  }

  // Check if next is an identifier (alias)
  if (nextNode && (nextNode.type.name === "Identifier" || nextNode.type.name === "QuotedIdentifier")) {
    const aliasText = state.sliceDoc(nextNode.from, nextNode.to);
    const sanitized = sanitizeAlias(aliasText);
    if (isValidAlias(sanitized)) {
      return sanitized;
    }
  }

  return undefined;
}

/**
 * Extract all table references from the entire document.
 * Uses instance-aware caching to prevent state corruption between editors.
 */
export function extractTableRefs(
  state: EditorState,
  instanceId: string = "default"
): TableRef[] {
  const cache = getInstanceCache<{ docHash: number; tables: TableRef[] }>(
    instanceId,
    "table-refs",
    CACHE_CONFIG.METADATA_MAX_SIZE,
    CACHE_CONFIG.METADATA_TTL
  );

  const docHash = hashDocument(state.doc);
  const cacheKey = String(docHash);

  const cached = cache.get(cacheKey);
  if (cached && cached.docHash === docHash) {
    return cached.tables;
  }

  const tables: TableRef[] = [];
  const seen = new Set<string>();
  const tree = syntaxTree(state);
  const cursor = tree.cursor();

  do {
    if (cursor.name === "Identifier" || cursor.name === "QuotedIdentifier") {
      const prevSibling = cursor.node.prevSibling;

      if (prevSibling?.type.name === "Keyword") {
        const keyword = state.sliceDoc(prevSibling.from, prevSibling.to).toLowerCase();
        if (TABLE_KEYWORDS_SET.has(keyword)) {
          const tableName = state.sliceDoc(cursor.from, cursor.to).replace(/["`[\]]/g, "");

          if (seen.has(tableName.toLowerCase())) continue;
          seen.add(tableName.toLowerCase());

          // Check for schema.table notation
          let schema: string | undefined;
          if (prevSibling.prevSibling?.type.name === ".") {
            const schemaNode = prevSibling.prevSibling.prevSibling;
            if (schemaNode) {
              schema = state.sliceDoc(schemaNode.from, schemaNode.to).replace(/["`[\]]/g, "");
            }
          }

          // Extract alias
          const alias = extractAlias(state, cursor.node);
          if (alias) seen.add(alias.toLowerCase());

          tables.push({ name: tableName, alias, schema });
        }
      }
    }
  } while (cursor.next());

  // Parse CTEs and add them to tables
  const ctes = parseCTEs(state.doc.toString());
  for (const cte of ctes) {
    if (!seen.has(cte.name.toLowerCase())) {
      tables.push(cte);
      seen.add(cte.name.toLowerCase());
    }
  }

  cache.set(cacheKey, { docHash, tables });
  return tables;
}

// CTE cache
let cachedCTEs: { sql: string; hash: number; ctes: TableRef[] } | null = null;

/**
 * Parse CTEs from SQL text.
 * Extracts CTE names, columns, and source tables.
 */
export function parseCTEs(sql: string): TableRef[] {
  const hash = hashString(sql);
  if (cachedCTEs && cachedCTEs.hash === hash && cachedCTEs.sql === sql) {
    return cachedCTEs.ctes;
  }

  const ctes: TableRef[] = [];
  const withMatch = sql.match(/\bWITH\s+/i);
  if (!withMatch) {
    cachedCTEs = { sql, hash, ctes };
    return ctes;
  }

  const withStart = withMatch.index ?? -1;
  if (withStart < 0) {
    cachedCTEs = { sql, hash, ctes };
    return ctes;
  }

  const afterWith = sql.slice(withStart + withMatch[0].length);
  const ctePattern = /(\w+)\s+AS\s*\(/gi;
  let match;

  while ((match = ctePattern.exec(afterWith)) !== null) {
    const cteName = match[1];
    if (!cteName) continue;
    const startParen = match.index + match[0].length - 1;

    // Find matching closing paren
    let depth = 1;
    let endParen = startParen + 1;
    while (depth > 0 && endParen < afterWith.length) {
      if (afterWith[endParen] === "(") depth++;
      if (afterWith[endParen] === ")") depth--;
      endParen++;
    }

    const cteBody = afterWith.slice(startParen + 1, endParen - 1);
    const selectMatch = cteBody.match(/^\s*SELECT\s+([\s\S]*?)\s+FROM\s+(\w+)/i);

    if (selectMatch && selectMatch[1] && selectMatch[2]) {
      const columnsPart = selectMatch[1].trim();
      const sourceTable = selectMatch[2];
      let cteColumns: string[] | undefined;

      if (columnsPart === "*") {
        cteColumns = undefined;
      } else {
        cteColumns = columnsPart
          .split(",")
          .map((col) => {
            const parts = col.trim().split(/\s+(?:AS\s+)?/i);
            const lastPart = parts[parts.length - 1];
            if (!lastPart) return "";
            const name = lastPart.replace(/["`[\]]/g, "");
            if (name.includes(".")) {
              const dotParts = name.split(".");
              return dotParts[dotParts.length - 1] || "";
            }
            return name;
          })
          .filter((col): col is string => Boolean(col));
      }

      ctes.push({
        name: cteName,
        alias: cteName,
        isCTE: true,
        cteColumns,
        cteSourceTable: sourceTable,
      });
    } else {
      // CTE without parseable SELECT - still add it as a table reference
      ctes.push({
        name: cteName,
        alias: cteName,
        isCTE: true,
      });
    }
  }

  cachedCTEs = { sql, hash, ctes };
  return ctes;
}

/**
 * Resolve an alias or table name to the actual table name.
 */
export function resolveTableAlias(
  qualifier: string,
  tables: TableRef[]
): { tableName: string; schema?: string } {
  const q = qualifier.toLowerCase();

  for (const table of tables) {
    if (table.alias?.toLowerCase() === q) {
      return { tableName: table.name, schema: table.schema };
    }
    if (table.name.toLowerCase() === q) {
      return { tableName: table.name, schema: table.schema };
    }
  }

  return { tableName: qualifier };
}

// Re-export TABLE_CLAUSE_TYPES for use in context.ts
export { TABLE_CLAUSE_TYPES };
