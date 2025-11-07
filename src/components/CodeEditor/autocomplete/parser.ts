import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export interface TableReference {
  database?: string;
  schema?: string;
  table: string;
  alias?: string;
  isQuoted?: boolean;
}

export interface ColumnReference {
  tableRef?: string;
  column: string;
  alias?: string;
  isQuoted?: boolean;
}

export interface QueryContext {
  cursorPosition: number;
  currentClause:
    | "SELECT"
    | "FROM"
    | "WHERE"
    | "JOIN"
    | "GROUP BY"
    | "ORDER BY"
    | "HAVING"
    | "WITH"
    | "INSERT"
    | "UPDATE"
    | "DELETE"
    | "SET"
    | "VALUES"
    | "UNKNOWN";
  tablesInScope: TableReference[];
  columnsInScope: ColumnReference[];
  currentTable?: TableReference;
  aliases: Map<string, TableReference>;
  ctes: Map<string, TableReference>;
  subqueries: QueryContext[];
  currentSchema?: string;
  currentDatabase?: string;
  prefix?: string;
  isInString?: boolean;
  isInComment?: boolean;
  queryBoundaries: { start: number; end: number };
  joinConditions: Array<{ left: string; right: string }>;
}

export class SqlQueryParser {
  // Note: SQL_KEYWORDS check removed as aliases CAN be keywords in most SQL dialects
  // Kept for reference if needed in the future
  // private readonly SQL_KEYWORDS = new Set([
  //   'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
  //   'GROUP', 'BY', 'ORDER', 'HAVING', 'WITH', 'AS', 'ON', 'AND', 'OR',
  //   'INSERT', 'UPDATE', 'DELETE', 'SET', 'VALUES', 'INTO', 'UNION', 'ALL',
  //   'DISTINCT', 'LIMIT', 'OFFSET', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'
  // ]);

  parseContext(state: EditorState, pos: number): QueryContext {
    const tree = syntaxTree(state);
    const text = state.doc.toString();

    // Find query boundaries
    const queryBoundaries = this.findQueryBoundaries(text, pos);
    const queryText = text.slice(queryBoundaries.start, queryBoundaries.end);

    // Check if cursor is in string or comment
    const nodeAtCursor = tree.resolveInner(pos, -1);
    const isInString = this.isInStringLiteral(nodeAtCursor);
    const isInComment = this.isInComment(nodeAtCursor);

    // Parse CTEs first
    const ctes = this.parseCTEs(queryText);

    // Find current clause using AST
    const currentClause = this.identifyClauseFromAST(tree, pos, text);

    // Extract tables with proper AST traversal
    const tables = this.extractTablesFromAST(tree, state, queryBoundaries);

    // Parse aliases from AST
    const aliases = this.parseAliasesFromAST(tree, state, queryBoundaries);

    // Extract columns in scope
    const columns = this.extractColumnsFromAST(tree, state, queryBoundaries);

    // Detect join conditions
    const joinConditions = this.extractJoinConditions(state, queryBoundaries);

    // Get current database/schema context
    const { database, schema } = this.getCurrentContext(state, pos);

    // Get prefix (partial word being typed)
    const prefix = this.getPrefix(state, pos);

    return {
      cursorPosition: pos,
      currentClause,
      tablesInScope: tables,
      columnsInScope: columns,
      currentTable: tables[tables.length - 1],
      aliases,
      ctes,
      subqueries: [],
      currentSchema: schema,
      currentDatabase: database,
      prefix,
      isInString,
      isInComment,
      queryBoundaries,
      joinConditions,
    };
  }

  private findQueryBoundaries(
    text: string,
    pos: number,
  ): { start: number; end: number } {
    // Find statement boundaries by looking for semicolons
    const lines = text.split("\n");
    let currentPos = 0;
    let queryStart = 0;
    let queryEnd = text.length;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextPos = currentPos + (line ? line.length : 0) + 1;

      // Check for semicolons not in strings
      const semicolons = this.findSemicolonsNotInStrings(line);
      for (const semicolonPos of semicolons) {
        const absolutePos = currentPos + semicolonPos;
        if (absolutePos < pos) {
          queryStart = absolutePos + 1;
        } else if (absolutePos >= pos) {
          queryEnd = absolutePos;
          break;
        }
      }

      if (nextPos > pos && queryEnd !== text.length) break;
      currentPos = nextPos;
    }

    return { start: queryStart, end: queryEnd };
  }

  private findSemicolonsNotInStrings(line: string | undefined): number[] {
    const positions: number[] = [];
    if (!line) return positions;

    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let inDollarQuote = false;
    let dollarQuoteTag = "";

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const prevChar = i > 0 ? line[i - 1] : "";

      // Check for dollar quotes (PostgreSQL): $tag$ or $$
      if (char === "$" && !inSingleQuote && !inDoubleQuote && !inBacktick) {
        const dollarMatch = line.slice(i).match(/^(\$\w*\$)/);
        if (dollarMatch && dollarMatch[1]) {
          const tag = dollarMatch[1];
          if (inDollarQuote && tag === dollarQuoteTag) {
            inDollarQuote = false;
            dollarQuoteTag = "";
            i += tag.length - 1;
            continue;
          } else if (!inDollarQuote) {
            inDollarQuote = true;
            dollarQuoteTag = tag;
            i += tag.length - 1;
            continue;
          }
        }
      }

      if (char === "'" && prevChar !== "\\" && !inDollarQuote)
        inSingleQuote = !inSingleQuote;
      else if (char === '"' && prevChar !== "\\" && !inDollarQuote)
        inDoubleQuote = !inDoubleQuote;
      else if (char === "`" && prevChar !== "\\" && !inDollarQuote)
        inBacktick = !inBacktick;
      else if (
        char === ";" &&
        !inSingleQuote &&
        !inDoubleQuote &&
        !inBacktick &&
        !inDollarQuote
      ) {
        positions.push(i);
      }
    }

    return positions;
  }

  private isInStringLiteral(node: SyntaxNode): boolean {
    let current: SyntaxNode | null = node;
    while (current) {
      if (
        current.name === "String" ||
        current.name === "QuotedIdentifier" ||
        current.name === "StringLiteral"
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  private isInComment(node: SyntaxNode): boolean {
    let current: SyntaxNode | null = node;
    while (current) {
      if (
        current.name === "Comment" ||
        current.name === "LineComment" ||
        current.name === "BlockComment"
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  private identifyClauseFromAST(
    tree: any,
    pos: number,
    text: string,
  ): QueryContext["currentClause"] {
    const node = tree.resolveInner(pos, -1);
    let current: SyntaxNode | null = node;

    // Walk up the tree to find clause node
    while (current) {
      const nodeName = current.name.toUpperCase();

      // Direct clause nodes
      if (nodeName.includes("SELECT")) return "SELECT";
      if (nodeName.includes("FROM")) return "FROM";
      if (nodeName.includes("WHERE")) return "WHERE";
      if (nodeName.includes("JOIN")) return "JOIN";
      if (nodeName.includes("GROUP")) return "GROUP BY";
      if (nodeName.includes("ORDER")) return "ORDER BY";
      if (nodeName.includes("HAVING")) return "HAVING";
      if (nodeName.includes("WITH")) return "WITH";
      if (nodeName.includes("INSERT")) return "INSERT";
      if (nodeName.includes("UPDATE")) return "UPDATE";
      if (nodeName.includes("DELETE")) return "DELETE";
      if (nodeName.includes("SET")) return "SET";
      if (nodeName.includes("VALUES")) return "VALUES";

      current = current.parent;
    }

    // Fallback to text-based detection
    return this.identifyClauseFromText(text, pos);
  }

  private identifyClauseFromText(
    text: string,
    pos: number,
  ): QueryContext["currentClause"] {
    // Get text before cursor (limit to current query)
    const beforeCursor = text.slice(Math.max(0, pos - 500), pos);
    const beforeCursorUpper = beforeCursor.toUpperCase();

    // Check if we're after a complete FROM clause with table
    // Pattern: FROM <table> <cursor> or FROM <table> AS <alias> <cursor>
    const fromTablePattern =
      /\bFROM\s+([a-zA-Z_][\w.]*|\[[^\]]+\]|`[^`]+`|"[^"]+")(?:\s+(?:AS\s+)?[a-zA-Z_]\w*)?\s*$/i;
    if (fromTablePattern.test(beforeCursor)) {
      // We've completed FROM with a table, now expecting next clause
      return "FROM"; // But mark as completed - will handle in sources
    }

    // Find the last occurrence of each clause
    const clauses: Array<[QueryContext["currentClause"], RegExp]> = [
      ["VALUES", /\bVALUES\b/g],
      ["SET", /\bSET\b/g],
      ["DELETE", /\bDELETE\s+FROM\b/g],
      ["UPDATE", /\bUPDATE\b/g],
      ["INSERT", /\bINSERT\s+INTO\b/g],
      ["WITH", /\bWITH\b/g],
      ["HAVING", /\bHAVING\b/g],
      ["ORDER BY", /\bORDER\s+BY\b/g],
      ["GROUP BY", /\bGROUP\s+BY\b/g],
      ["JOIN", /\b(?:LEFT|RIGHT|INNER|OUTER|FULL)?\s*JOIN\b/g],
      ["WHERE", /\bWHERE\b/g],
      ["FROM", /\bFROM\b/g],
      ["SELECT", /\bSELECT\b/g],
    ];

    let bestMatch: {
      clause: QueryContext["currentClause"];
      position: number;
    } | null = null;

    for (const [clause, regex] of clauses) {
      let match;
      let lastPos = -1;
      while ((match = regex.exec(beforeCursorUpper)) !== null) {
        lastPos = match.index;
      }
      if (lastPos >= 0 && (!bestMatch || lastPos > bestMatch.position)) {
        bestMatch = { clause, position: lastPos };
      }
    }

    return bestMatch ? bestMatch.clause : "UNKNOWN";
  }

  private extractTablesFromAST(
    tree: any,
    state: EditorState,
    boundaries: { start: number; end: number },
  ): TableReference[] {
    const tables: TableReference[] = [];
    const seen = new Set<string>();

    // First try AST extraction
    tree.iterate({
      enter: (node: SyntaxNode) => {
        // Only process nodes within query boundaries
        if (node.from < boundaries.start || node.to > boundaries.end) return;

        // Look for table references
        if (
          node.name === "TableName" ||
          node.name === "Table" ||
          node.name === "TableRef" ||
          (node.name === "Identifier" && this.isTableContext(node))
        ) {
          const text = state.doc.sliceString(node.from, node.to);
          const table = this.parseTableReference(text);
          const key = `${table.schema || "default"}.${table.table}`;

          if (!seen.has(key)) {
            seen.add(key);
            tables.push(table);
          }
        }
      },
    });

    // Fallback to text-based extraction if no tables found
    if (tables.length === 0) {
      const queryText = state.doc.sliceString(boundaries.start, boundaries.end);
      const fromPattern =
        /\bFROM\s+([a-zA-Z_][\w.]*|\[[^\]]+\]|`[^`]+`|"[^"]+")(?:\s+(?:AS\s+)?([a-zA-Z_]\w*))?/gi;
      const joinPattern =
        /\b(?:LEFT|RIGHT|INNER|OUTER|FULL)?\s*JOIN\s+([a-zA-Z_][\w.]*|\[[^\]]+\]|`[^`]+`|"[^"]+")(?:\s+(?:AS\s+)?([a-zA-Z_]\w*))?/gi;

      let match;
      while ((match = fromPattern.exec(queryText)) !== null) {
        const tableName = match[1];
        const alias = match[2];
        const table = this.parseTableReference(tableName);
        if (alias) table.alias = alias;
        const key = `${table.schema || "default"}.${table.table}`;
        if (!seen.has(key)) {
          seen.add(key);
          tables.push(table);
        }
      }

      while ((match = joinPattern.exec(queryText)) !== null) {
        const tableName = match[1];
        const alias = match[2];
        const table = this.parseTableReference(tableName);
        if (alias) table.alias = alias;
        const key = `${table.schema || "default"}.${table.table}`;
        if (!seen.has(key)) {
          seen.add(key);
          tables.push(table);
        }
      }
    }

    return tables;
  }

  private isTableContext(node: SyntaxNode): boolean {
    let parent = node.parent;
    while (parent) {
      const name = parent.name.toUpperCase();
      if (
        name.includes("FROM") ||
        name.includes("JOIN") ||
        name.includes("INTO")
      ) {
        return true;
      }
      parent = parent.parent;
    }
    return false;
  }

  private parseTableReference(text: string | undefined): TableReference {
    if (!text) {
      return { table: "", isQuoted: false };
    }

    // Remove quotes if present
    const isQuoted =
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("`") && text.endsWith("`")) ||
      (text.startsWith("[") && text.endsWith("]"));

    if (isQuoted) {
      text = text.slice(1, -1);
    }

    // Parse multi-part identifiers
    const parts = text.split(".");

    if (parts.length === 3) {
      return {
        database: this.unquote(parts[0]),
        schema: this.unquote(parts[1]),
        table: this.unquote(parts[2]),
        isQuoted,
      };
    } else if (parts.length === 2) {
      return {
        schema: this.unquote(parts[0]),
        table: this.unquote(parts[1]),
        isQuoted,
      };
    } else {
      return {
        table: this.unquote(parts[0]),
        isQuoted,
      };
    }
  }

  private unquote(text: string | undefined): string {
    if (!text) return "";
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("`") && text.endsWith("`")) ||
      (text.startsWith("[") && text.endsWith("]"))
    ) {
      return text.slice(1, -1);
    }
    return text;
  }

  private parseAliasesFromAST(
    tree: any,
    state: EditorState,
    boundaries: { start: number; end: number },
  ): Map<string, TableReference> {
    const aliases = new Map<string, TableReference>();

    tree.iterate({
      enter: (node: SyntaxNode) => {
        if (node.from < boundaries.start || node.to > boundaries.end) return;

        // Look for alias definitions
        if (node.name === "Alias" || node.name === "TableAlias") {
          const aliasText = state.doc.sliceString(node.from, node.to);
          // Find the preceding table reference
          const tableNode = this.findPrecedingTable(node);
          if (tableNode) {
            const tableText = state.doc.sliceString(
              tableNode.from,
              tableNode.to,
            );
            const tableRef = this.parseTableReference(tableText);
            aliases.set(aliasText.toLowerCase(), tableRef);
          }
        }
      },
    });

    // Also parse using pattern matching as fallback
    const queryText = state.doc.sliceString(boundaries.start, boundaries.end);

    // Pattern 1: Explicit FROM/JOIN with optional AS
    const fromJoinPattern =
      /(?:FROM|JOIN)\s+([^\s,]+)(?:\s+(?:AS\s+)?([a-zA-Z_]\w*))?/gi;
    let match;
    while ((match = fromJoinPattern.exec(queryText)) !== null) {
      const [, tablePart, aliasPart] = match;
      if (aliasPart) {
        const tableRef = this.parseTableReference(tablePart);
        if (tableRef.table) {
          aliases.set(aliasPart.toLowerCase(), tableRef);
        }
      }
    }

    // Pattern 2: Comma-separated tables with implicit aliases
    // e.g., "FROM users u, posts p" or "FROM users u, posts AS p"
    const commaPattern = /,\s*([^\s,]+)(?:\s+(?:AS\s+)?([a-zA-Z_]\w*))?/gi;
    while ((match = commaPattern.exec(queryText)) !== null) {
      const [, tablePart, aliasPart] = match;
      if (aliasPart) {
        const tableRef = this.parseTableReference(tablePart);
        if (tableRef.table) {
          aliases.set(aliasPart.toLowerCase(), tableRef);
        }
      }
    }

    return aliases;
  }

  private findPrecedingTable(aliasNode: SyntaxNode): SyntaxNode | null {
    let sibling = aliasNode.prevSibling;
    while (sibling) {
      if (
        sibling.name === "TableName" ||
        sibling.name === "Table" ||
        sibling.name === "Identifier"
      ) {
        return sibling;
      }
      sibling = sibling.prevSibling;
    }
    return null;
  }

  private extractColumnsFromAST(
    tree: any,
    state: EditorState,
    boundaries: { start: number; end: number },
  ): ColumnReference[] {
    const columns: ColumnReference[] = [];

    tree.iterate({
      enter: (node: SyntaxNode) => {
        if (node.from < boundaries.start || node.to > boundaries.end) return;

        // Look for column references
        if (
          node.name === "Column" ||
          node.name === "ColumnRef" ||
          node.name === "Field" ||
          (node.name === "Identifier" && this.isColumnContext(node))
        ) {
          const text = state.doc.sliceString(node.from, node.to);
          const column = this.parseColumnReference(text);
          columns.push(column);
        }
      },
    });

    return columns;
  }

  private isColumnContext(node: SyntaxNode): boolean {
    let parent = node.parent;
    while (parent) {
      const name = parent.name.toUpperCase();
      if (
        name.includes("SELECT") ||
        name.includes("WHERE") ||
        name.includes("GROUP") ||
        name.includes("ORDER") ||
        name.includes("HAVING")
      ) {
        return true;
      }
      parent = parent.parent;
    }
    return false;
  }

  private parseColumnReference(text: string | undefined): ColumnReference {
    if (!text) {
      return { column: "", isQuoted: false };
    }

    const isQuoted =
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("`") && text.endsWith("`")) ||
      (text.startsWith("[") && text.endsWith("]"));

    if (isQuoted) {
      text = text.slice(1, -1);
    }

    const parts = text.split(".");

    if (parts.length === 2) {
      return {
        tableRef: this.unquote(parts[0]),
        column: this.unquote(parts[1]),
        isQuoted,
      };
    } else {
      return {
        column: this.unquote(parts[0]),
        isQuoted,
      };
    }
  }

  private parseCTEs(queryText: string): Map<string, TableReference> {
    const ctes = new Map<string, TableReference>();
    const cteRegex =
      /WITH\s+(?:RECURSIVE\s+)?([a-zA-Z_]\w*)\s+(?:\([^)]*\))?\s+AS\s*\(/gi;

    let match;
    while ((match = cteRegex.exec(queryText)) !== null) {
      const cteName = match[1];
      if (cteName) {
        ctes.set(cteName.toLowerCase(), {
          table: cteName,
          isQuoted: false,
        });
      }
    }

    return ctes;
  }

  private extractJoinConditions(
    state: EditorState,
    boundaries: { start: number; end: number },
  ): Array<{ left: string; right: string }> {
    const conditions: Array<{ left: string; right: string }> = [];
    const queryText = state.doc.sliceString(boundaries.start, boundaries.end);

    // Simple pattern for JOIN ON conditions
    const joinPattern =
      /JOIN\s+[^\s]+(?:\s+[a-zA-Z_]\w*)?\s+ON\s+([^WHERE|GROUP|ORDER|HAVING]+)/gi;

    let match;
    while ((match = joinPattern.exec(queryText)) !== null) {
      const onClause = match[1];
      // Parse equality conditions
      const condPattern = /([a-zA-Z_][\w.]*)\s*=\s*([a-zA-Z_][\w.]*)/g;
      let condMatch;
      while ((condMatch = condPattern.exec(onClause || "")) !== null) {
        if (condMatch[1] && condMatch[2]) {
          conditions.push({
            left: condMatch[1],
            right: condMatch[2],
          });
        }
      }
    }

    return conditions;
  }

  private getCurrentContext(
    state: EditorState,
    pos: number,
  ): { database?: string; schema?: string } {
    // Look for USE statements before cursor
    const textBefore = state.doc.sliceString(0, pos);

    // Find last USE DATABASE statement
    const dbMatch = /USE\s+(?:DATABASE\s+)?([a-zA-Z_]\w*)/gi.exec(textBefore);
    const database = dbMatch ? dbMatch[1] : undefined;

    // Find last SET SCHEMA or USE SCHEMA statement
    const schemaMatch = /(?:SET|USE)\s+SCHEMA\s+([a-zA-Z_]\w*)/gi.exec(
      textBefore,
    );
    const schema = schemaMatch ? schemaMatch[1] : undefined;

    return { database, schema };
  }

  private getPrefix(state: EditorState, pos: number): string {
    // Get text before cursor
    const line = state.doc.lineAt(pos);
    const textBefore = state.doc.sliceString(line.from, pos);

    // Extract identifier including dots (e.g., "table.col" or "schema.table.")
    const match = /([a-zA-Z_][\w.]*)$/.exec(textBefore);
    return match ? match[1] ?? "" : "";
  }
}


