/**
 * Web Worker for SQL Completion Analysis
 *
 * Offloads expensive context analysis from the main thread.
 */

import { sql, PostgreSQL, MySQL, SQLite, MSSQL, PLSQL } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

// Types for worker communication
export interface CompletionWorkerRequest {
  id: number;
  type: 'analyze';
  payload: {
    content: string;
    pos: number;
    dialect?: string;
    defaultSchema: string;
  };
}

export interface TableInfo {
  name: string;
  alias?: string;
  schema?: string;
  isCTE?: boolean;
  cteColumns?: string[];
  cteSourceTable?: string;
}

export interface ContextAnalysis {
  intent: 'column' | 'table' | 'unknown';
  qualifier?: string;
  identifier: string;
  range: { from: number; to: number };
  activeStatementTables: TableInfo[];
  outerScopeTables?: TableInfo[];
  isInsertContext: boolean;
  insertTargetTable?: string;
}

export interface CompletionWorkerResponse {
  id: number;
  type: 'result' | 'error';
  payload: {
    analysis?: ContextAnalysis;
    error?: string;
  };
}

// Get dialect for EditorState
const getDialect = (dialect?: string) => {
  switch (dialect) {
    case "mysql": return MySQL;
    case "sqlite": return SQLite;
    case "plsql": return PLSQL;
    case "mssql": return MSSQL;
    default: return PostgreSQL;
  }
};

// SQL keywords for intent detection
const TABLE_KEYWORDS = new Set([
  "FROM", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL",
  "INTO", "UPDATE", "TABLE", "TRUNCATE"
]);

const COLUMN_KEYWORDS = new Set([
  "SELECT", "WHERE", "AND", "OR", "ON", "SET", "ORDER", "GROUP",
  "HAVING", "BY", "CASE", "WHEN", "THEN", "ELSE", "END", "AS",
  "BETWEEN", "IN", "LIKE", "IS", "NOT", "NULL", "EXISTS",
  "VALUES", "RETURNING"
]);

// Analyze SQL context
function analyzeContext(
  content: string,
  pos: number,
  dialect: string | undefined,
  _defaultSchema: string
): ContextAnalysis {
  // Create a temporary EditorState for parsing
  const dialectLang = getDialect(dialect);
  const state = EditorState.create({
    doc: content,
    extensions: [sql({ dialect: dialectLang })]
  });

  const tree = syntaxTree(state);

  // Find identifier at cursor
  let identifier = "";
  let qualifier: string | undefined;
  let rangeFrom = pos;
  let rangeTo = pos;

  // Look backwards for identifier
  const beforeCursor = content.slice(0, pos);
  const identMatch = beforeCursor.match(/(["\w`[\]]+\.)?(["\w`[\]]*?)$/);
  if (identMatch) {
    const fullMatch = identMatch[0];
    rangeFrom = pos - fullMatch.length;

    if (identMatch[1] && identMatch[2] !== undefined) {
      qualifier = identMatch[1].slice(0, -1).replace(/["`[\]]/g, "");
      identifier = identMatch[2].replace(/["`[\]]/g, "");
      rangeFrom = pos - identMatch[2].length;
    } else if (identMatch[2] !== undefined) {
      identifier = identMatch[2].replace(/["`[\]]/g, "");
    }
  }

  // Determine intent from preceding keyword
  let intent: 'column' | 'table' | 'unknown' = 'unknown';
  const textBefore = beforeCursor.toUpperCase();

  // Find last significant keyword
  const keywordMatch = textBefore.match(/\b(SELECT|FROM|JOIN|WHERE|AND|OR|ON|SET|ORDER|GROUP|HAVING|BY|INTO|UPDATE|VALUES|RETURNING)\b[^A-Z]*$/i);
  if (keywordMatch && keywordMatch[1]) {
    const keyword = keywordMatch[1].toUpperCase();
    if (TABLE_KEYWORDS.has(keyword)) {
      intent = 'table';
    } else if (COLUMN_KEYWORDS.has(keyword)) {
      intent = 'column';
    }
  }

  // Extract tables from current statement
  const tables = extractTablesFromStatement(state, tree, pos);

  // Check for INSERT context
  let isInsertContext = false;
  let insertTargetTable: string | undefined;

  const insertMatch = content.slice(0, pos).match(/INSERT\s+INTO\s+(["\w`[\].]+)\s*\([^)]*$/i);
  if (insertMatch && insertMatch[1]) {
    isInsertContext = true;
    const parts = insertMatch[1].replace(/["`[\]]/g, "").split('.');
    insertTargetTable = parts[parts.length - 1] || undefined;
  }

  return {
    intent,
    qualifier,
    identifier,
    range: { from: rangeFrom, to: rangeTo },
    activeStatementTables: tables,
    isInsertContext,
    insertTargetTable
  };
}

// Extract tables from statement
function extractTablesFromStatement(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
  pos: number
): TableInfo[] {
  const tables: TableInfo[] = [];
  const content = state.doc.toString();

  // Find statement containing cursor
  let node: SyntaxNode | null = tree.resolveInner(pos, -1);
  while (node && !node.type.name.includes("Statement") && node.parent) {
    node = node.parent;
  }

  if (!node) {
    node = tree.topNode;
  }

  const statementText = content.slice(node.from, node.to);

  // Extract CTEs
  const cteRegex = /WITH\s+(?:RECURSIVE\s+)?(.+?)\s+(?=SELECT|INSERT|UPDATE|DELETE)/is;
  const cteMatch = statementText.match(cteRegex);
  if (cteMatch && cteMatch[1]) {
    const cteDefinitions = cteMatch[1];
    const ctePattern = /(\w+)\s*(?:\(([^)]+)\))?\s*AS\s*\(/gi;
    let cteMatchItem;
    while ((cteMatchItem = ctePattern.exec(cteDefinitions)) !== null) {
      const cteName = cteMatchItem[1];
      if (cteName) {
        const cteColumns = cteMatchItem[2]?.split(',').map(c => c.trim());
        tables.push({
          name: cteName,
          isCTE: true,
          cteColumns
        });
      }
    }
  }

  // Extract FROM/JOIN tables
  const fromJoinRegex = /(?:FROM|JOIN)\s+(["\w`[\].]+)(?:\s+(?:AS\s+)?(["\w`[\]]+))?/gi;
  let match;
  while ((match = fromJoinRegex.exec(statementText)) !== null) {
    if (!match[1]) continue;
    const fullName = match[1].replace(/["`[\]]/g, "");
    const alias = match[2]?.replace(/["`[\]]/g, "");

    const parts = fullName.split('.');
    const tableName = parts.pop() || "";
    const schema = parts.pop();

    tables.push({
      name: tableName,
      alias,
      schema
    });
  }

  return tables;
}

// Handle messages
self.onmessage = (event: MessageEvent<CompletionWorkerRequest>) => {
  const { id, type, payload } = event.data;

  if (type === 'analyze') {
    try {
      const analysis = analyzeContext(
        payload.content,
        payload.pos,
        payload.dialect,
        payload.defaultSchema
      );

      const response: CompletionWorkerResponse = {
        id,
        type: 'result',
        payload: { analysis }
      };

      self.postMessage(response);
    } catch (error) {
      const response: CompletionWorkerResponse = {
        id,
        type: 'error',
        payload: { error: error instanceof Error ? error.message : 'Unknown error' }
      };

      self.postMessage(response);
    }
  }
};
