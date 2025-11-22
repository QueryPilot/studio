/**
 * SQL Symbol Table
 *
 * Provides efficient symbol resolution for SQL queries.
 * Caches tables, aliases, CTEs, and columns per parse.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type SymbolType = "table" | "alias" | "cte" | "column" | "schema";

export interface Symbol {
  name: string;
  type: SymbolType;
  from: number;
  to: number;
  // For aliases and CTEs, reference to the source
  sourceTable?: string;
  sourceSchema?: string;
  // For CTEs, the columns they expose
  columns?: string[];
  // Scope information
  scopeFrom: number;
  scopeTo: number;
}

export interface SymbolTable {
  symbols: Map<string, Symbol[]>; // name -> symbols (can have multiple with same name in different scopes)
  scopeSymbols: Map<string, Symbol[]>; // scope key -> symbols in that scope
}

// Node types that define scope boundaries
const SCOPE_NODES = new Set([
  "SelectStatement",
  "InsertStatement",
  "UpdateStatement",
  "DeleteStatement",
  "Subquery",
]);

// Keywords that introduce table references
const TABLE_KEYWORDS = new Set(["from", "join", "update", "into", "table"]);

/**
 * Build a symbol table from the current editor state
 */
export function buildSymbolTable(state: EditorState): SymbolTable {
  const tree = syntaxTree(state);
  const symbols = new Map<string, Symbol[]>();
  const scopeSymbols = new Map<string, Symbol[]>();

  // Helper to add symbol
  const addSymbol = (symbol: Symbol) => {
    const key = symbol.name.toLowerCase();
    if (!symbols.has(key)) {
      symbols.set(key, []);
    }
    symbols.get(key)!.push(symbol);

    const scopeKey = `${symbol.scopeFrom}-${symbol.scopeTo}`;
    if (!scopeSymbols.has(scopeKey)) {
      scopeSymbols.set(scopeKey, []);
    }
    scopeSymbols.get(scopeKey)!.push(symbol);
  };

  // Parse CTEs first (WITH clause)
  const content = state.doc.toString();
  const withMatch = content.match(/\bWITH\s+/i);
  if (withMatch && withMatch.index !== undefined) {
    parseCTEs(state, content, withMatch.index, addSymbol);
  }

  // Walk the tree to find table references and aliases
  const cursor = tree.cursor();

  do {
    // Find scope boundaries
    let scopeFrom = 0;
    let scopeTo = state.doc.length;

    if (SCOPE_NODES.has(cursor.name)) {
      scopeFrom = cursor.from;
      scopeTo = cursor.to;
    } else {
      // Find enclosing scope
      let parent = cursor.node.parent;
      while (parent) {
        if (SCOPE_NODES.has(parent.name)) {
          scopeFrom = parent.from;
          scopeTo = parent.to;
          break;
        }
        parent = parent.parent;
      }
    }

    // Look for table identifiers
    if (cursor.name === "Identifier" || cursor.name === "QuotedIdentifier") {
      const prevSibling = cursor.node.prevSibling;
      const text = state.sliceDoc(cursor.from, cursor.to).replace(/["`[\]]/g, "");

      // Check if this follows a table keyword
      if (prevSibling?.name === "Keyword") {
        const keyword = state.sliceDoc(prevSibling.from, prevSibling.to).toLowerCase();
        if (TABLE_KEYWORDS.has(keyword)) {
          // This is a table reference
          let schema: string | undefined;

          // Check for schema prefix (schema.table)
          if (prevSibling.prevSibling?.name === "." && prevSibling.prevSibling.prevSibling) {
            schema = state.sliceDoc(
              prevSibling.prevSibling.prevSibling.from,
              prevSibling.prevSibling.prevSibling.to
            ).replace(/["`[\]]/g, "");
          }

          addSymbol({
            name: text,
            type: "table",
            from: cursor.from,
            to: cursor.to,
            sourceSchema: schema,
            scopeFrom,
            scopeTo,
          });

          // Check for alias
          let nextNode = cursor.node.nextSibling;
          if (nextNode?.name === "Keyword") {
            const kw = state.sliceDoc(nextNode.from, nextNode.to).toLowerCase();
            if (kw === "as") {
              nextNode = nextNode.nextSibling;
            }
          }

          if (nextNode && (nextNode.name === "Identifier" || nextNode.name === "QuotedIdentifier")) {
            const alias = state.sliceDoc(nextNode.from, nextNode.to).replace(/["`[\]]/g, "");
            addSymbol({
              name: alias,
              type: "alias",
              from: nextNode.from,
              to: nextNode.to,
              sourceTable: text,
              sourceSchema: schema,
              scopeFrom,
              scopeTo,
            });
          }
        }
      }
    }
  } while (cursor.next());

  return { symbols, scopeSymbols };
}

/**
 * Parse CTEs from WITH clause
 */
function parseCTEs(
  _state: EditorState,
  content: string,
  withIndex: number,
  addSymbol: (symbol: Symbol) => void
): void {
  const afterWith = content.slice(withIndex + 4); // Skip "WITH"
  const ctePattern = /(\w+)\s+AS\s*\(/gi;
  let match;

  while ((match = ctePattern.exec(afterWith)) !== null) {
    const cteName = match[1];
    if (!cteName) continue;

    const cteFrom = withIndex + 4 + match.index;
    const cteTo = cteFrom + cteName.length;
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

    // Parse SELECT to get columns
    const selectMatch = cteBody.match(/^\s*SELECT\s+([\s\S]*?)\s+FROM\s+(\w+)/i);
    let columns: string[] | undefined;
    let sourceTable: string | undefined;

    if (selectMatch && selectMatch[1]) {
      const columnsPart = selectMatch[1].trim();
      sourceTable = selectMatch[2];

      if (columnsPart !== "*") {
        columns = columnsPart
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
          .filter(Boolean);
      }
    }

    // Scope for CTE is from after its definition to end of statement
    const scopeFrom = withIndex + 4 + endParen;
    const scopeTo = content.length;

    addSymbol({
      name: cteName,
      type: "cte",
      from: cteFrom,
      to: cteTo,
      sourceTable,
      columns,
      scopeFrom,
      scopeTo,
    });
  }
}

/**
 * Resolve a symbol at a given position
 */
export function resolveSymbol(
  table: SymbolTable,
  name: string,
  pos: number
): Symbol | undefined {
  const symbols = table.symbols.get(name.toLowerCase());
  if (!symbols) return undefined;

  // Find symbol whose scope contains the position
  // Prefer the most specific (innermost) scope
  let best: Symbol | undefined;
  let bestScopeSize = Infinity;

  for (const symbol of symbols) {
    if (pos >= symbol.scopeFrom && pos <= symbol.scopeTo) {
      const scopeSize = symbol.scopeTo - symbol.scopeFrom;
      if (scopeSize < bestScopeSize) {
        best = symbol;
        bestScopeSize = scopeSize;
      }
    }
  }

  return best;
}

/**
 * Get all symbols in scope at a given position
 */
export function getSymbolsInScope(
  table: SymbolTable,
  pos: number,
  type?: SymbolType
): Symbol[] {
  const result: Symbol[] = [];

  for (const [, symbols] of table.symbols) {
    for (const symbol of symbols) {
      if (pos >= symbol.scopeFrom && pos <= symbol.scopeTo) {
        if (!type || symbol.type === type) {
          result.push(symbol);
        }
      }
    }
  }

  return result;
}

/**
 * Get all table/alias symbols in scope (for completion)
 */
export function getTablesInScope(table: SymbolTable, pos: number): Symbol[] {
  return getSymbolsInScope(table, pos).filter(
    (s) => s.type === "table" || s.type === "alias" || s.type === "cte"
  );
}

/**
 * Resolve a qualifier (e.g., "u" in "u.id") to its source table
 */
export function resolveQualifier(
  table: SymbolTable,
  qualifier: string,
  pos: number
): { tableName: string; schema?: string } | undefined {
  const symbol = resolveSymbol(table, qualifier, pos);

  if (!symbol) return undefined;

  if (symbol.type === "alias" || symbol.type === "cte") {
    return {
      tableName: symbol.sourceTable || symbol.name,
      schema: symbol.sourceSchema,
    };
  }

  if (symbol.type === "table") {
    return {
      tableName: symbol.name,
      schema: symbol.sourceSchema,
    };
  }

  return undefined;
}
