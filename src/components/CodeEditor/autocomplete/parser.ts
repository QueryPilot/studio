import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";

export interface TableReference {
  schema?: string;
  table: string;
  alias?: string;
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
    | "HAVING";
  tablesInScope: TableReference[];
  currentTable?: TableReference;
  aliases: Map<string, string>;
  ctes: Map<string, TableReference>;
  subqueries: QueryContext[];
  currentSchema?: string;
  prefix?: string;
}

export class SqlQueryParser {
  parseContext(state: EditorState, pos: number): QueryContext {
    const tree = syntaxTree(state);
    const node = tree.resolveInner(pos, -1);
    const clause = this.identifyClauseHeuristic(state, pos);
    const tables = this.extractTables(tree, state, pos);
    const aliases = this.parseAliases(state.doc.toString(), tables);
    const currentTable = this.getCurrentTable(node, tables, aliases);
    return {
      cursorPosition: pos,
      currentClause: clause,
      tablesInScope: tables,
      currentTable,
      aliases,
      ctes: new Map(),
      subqueries: [],
      currentSchema: undefined,
      prefix: undefined,
    };
  }

  private extractTables(
    tree: Tree,
    state: EditorState,
    beforePos: number,
  ): TableReference[] {
    const tables: TableReference[] = [];
    tree.iterate({
      enter: (node) => {
        if (
          (node.name === "TableName" || node.name === "Identifier") &&
          node.from < beforePos
        ) {
          const text = state.doc.sliceString(node.from, node.to);
          tables.push(this.parseTableReference(text));
        }
      },
    });
    return tables;
  }

  private parseTableReference(text: string): TableReference {
    const parts = text.split(".");
    if (parts.length === 2) {
      return { schema: parts[0], table: parts[1] };
    }
    return { table: text };
  }

  private parseAliases(
    query: string,
    tables: TableReference[],
  ): Map<string, string> {
    const aliases = new Map<string, string>();
    const patterns = [
      /FROM\s+(\S+)\s+(?:AS\s+)?(\w+)/gi,
      /JOIN\s+(\S+)\s+(?:AS\s+)?(\w+)/gi,
    ];
    patterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(query)) !== null) {
        const [, table, alias] = match;
        aliases.set(alias.toLowerCase(), table);
      }
    });
    return aliases;
  }

  // Lightweight heuristic: scan up to 200 chars before cursor for last clause keyword
  private identifyClauseHeuristic(
    state: EditorState,
    pos: number,
  ): QueryContext["currentClause"] {
    const start = Math.max(0, pos - 200);
    const text = state.doc.sliceString(start, pos).toLowerCase();
    const clauses: Array<[QueryContext["currentClause"], RegExp]> = [
      ["FROM", /\bfrom\b/g],
      ["WHERE", /\bwhere\b/g],
      ["JOIN", /\b(inner|left|right|full)?\s*join\b/g],
      ["GROUP BY", /\bgroup\s+by\b/g],
      ["ORDER BY", /\border\s+by\b/g],
      ["HAVING", /\bhaving\b/g],
      ["SELECT", /\bselect\b/g],
    ];
    let best: { k: QueryContext["currentClause"]; idx: number } | null = null;
    for (const [k, re] of clauses) {
      let m: RegExpExecArray | null;
      let last = -1;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) last = m.index;
      if (last >= 0 && (!best || last > best.idx)) best = { k, idx: last };
    }
    return best ? best.k : "SELECT";
  }
  private getCurrentTable(
    _node: any,
    tables: TableReference[],
    _aliases: Map<string, string>,
  ): TableReference | undefined {
    return tables[tables.length - 1];
  }
}
