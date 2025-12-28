/**
 * SQL Snippets Extension
 *
 * Provides VS Code-like snippet expansion with tab stops.
 * Triggered by typing prefix + Tab.
 */

import { EditorView, keymap, Decoration, type DecorationSet } from "@codemirror/view";
import {
  type EditorState,
  StateField,
  StateEffect,
  type Extension,
} from "@codemirror/state";
import { acceptCompletion } from "@codemirror/autocomplete";

export interface Snippet {
  prefix: string;
  body: string;
  description: string;
}

// Tab stop placeholder pattern: $1, $2, ${1:default}
const TAB_STOP_REGEX = /\$(\d+)|\$\{(\d+)(?::([^}]+))?\}/g;

interface TabStop {
  index: number;
  from: number;
  to: number;
  placeholder: string;
}

interface ActiveSnippet {
  tabStops: TabStop[];
  currentIndex: number;
  endPos: number;
}

// State effects
const setActiveSnippet = StateEffect.define<ActiveSnippet | null>();
const advanceTabStop = StateEffect.define<void>();

// State field for active snippet session
const activeSnippetField = StateField.define<ActiveSnippet | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setActiveSnippet)) {
        return effect.value;
      }
      if (effect.is(advanceTabStop) && value) {
        const nextIndex = value.currentIndex + 1;
        const nextStop = value.tabStops.find((s) => s.index === nextIndex);
        if (nextStop) {
          return { ...value, currentIndex: nextIndex };
        }
        // No more tab stops - exit snippet mode
        return null;
      }
    }

    // Only update positions when there's an active snippet session
    if (tr.docChanged && value) {
      // Exit snippet mode if changes are outside the snippet range
      const changeRange = { from: Infinity, to: -Infinity };
      tr.changes.iterChangedRanges((fromA, toA) => {
        changeRange.from = Math.min(changeRange.from, fromA);
        changeRange.to = Math.max(changeRange.to, toA);
      });

      // Map tab stop positions
      const newTabStops = value.tabStops.map((stop) => ({
        ...stop,
        from: tr.changes.mapPos(stop.from, 1),
        to: tr.changes.mapPos(stop.to, -1),
      }));

      // Validate tab stops are still valid
      const currentStop = newTabStops.find(s => s.index === value.currentIndex);
      if (!currentStop || currentStop.from > currentStop.to) {
        return null; // Exit snippet mode if current stop is invalid
      }

      return { ...value, tabStops: newTabStops };
    }

    return value;
  },
});

// Decoration for tab stop highlights
const tabStopHighlight = Decoration.mark({ class: "cm-snippet-tabstop" });

const tabStopDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_decorations, tr) {
    const snippet = tr.state.field(activeSnippetField);
    if (!snippet) return Decoration.none;

    const currentStop = snippet.tabStops.find(
      (s) => s.index === snippet.currentIndex
    );
    if (!currentStop) return Decoration.none;

    return Decoration.set([
      tabStopHighlight.range(currentStop.from, currentStop.to),
    ]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// SQL Snippets library
export const SQL_SNIPPETS: Snippet[] = [
  // Basic queries
  {
    prefix: "sel",
    body: "SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ${3:condition};",
    description: "SELECT statement",
  },
  {
    prefix: "selj",
    body: "SELECT ${1:columns}\nFROM ${2:table1} t1\nJOIN ${3:table2} t2 ON t1.${4:id} = t2.${5:foreign_id}\nWHERE ${6:condition};",
    description: "SELECT with JOIN",
  },
  {
    prefix: "sellj",
    body: "SELECT ${1:columns}\nFROM ${2:table1} t1\nLEFT JOIN ${3:table2} t2 ON t1.${4:id} = t2.${5:foreign_id}\nWHERE ${6:condition};",
    description: "SELECT with LEFT JOIN",
  },
  {
    prefix: "selg",
    body: "SELECT ${1:column}, COUNT(*) as count\nFROM ${2:table_name}\nGROUP BY ${1:column}\nHAVING COUNT(*) > ${3:1}\nORDER BY count DESC;",
    description: "SELECT with GROUP BY",
  },
  {
    prefix: "seld",
    body: "SELECT DISTINCT ${1:columns}\nFROM ${2:table_name}\nWHERE ${3:condition};",
    description: "SELECT DISTINCT",
  },
  {
    prefix: "selt",
    body: "SELECT ${1:*}\nFROM ${2:table_name}\nLIMIT ${3:10};",
    description: "SELECT TOP/LIMIT",
  },
  {
    prefix: "selc",
    body: "SELECT COUNT(*) FROM ${1:table_name} WHERE ${2:condition};",
    description: "SELECT COUNT",
  },

  // DML
  {
    prefix: "ins",
    body: "INSERT INTO ${1:table_name} (${2:columns})\nVALUES (${3:values});",
    description: "INSERT statement",
  },
  {
    prefix: "insm",
    body: "INSERT INTO ${1:table_name} (${2:columns})\nVALUES\n  (${3:values1}),\n  (${4:values2});",
    description: "INSERT multiple rows",
  },
  {
    prefix: "upd",
    body: "UPDATE ${1:table_name}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};",
    description: "UPDATE statement",
  },
  {
    prefix: "del",
    body: "DELETE FROM ${1:table_name}\nWHERE ${2:condition};",
    description: "DELETE statement",
  },
  {
    prefix: "upsert",
    body: "INSERT INTO ${1:table_name} (${2:columns})\nVALUES (${3:values})\nON CONFLICT (${4:constraint}) DO UPDATE\nSET ${5:column} = EXCLUDED.${5:column};",
    description: "UPSERT (INSERT ON CONFLICT)",
  },

  // DDL
  {
    prefix: "ct",
    body: "CREATE TABLE ${1:table_name} (\n  ${2:id} SERIAL PRIMARY KEY,\n  ${3:column} ${4:type} NOT NULL,\n  created_at TIMESTAMP DEFAULT NOW()\n);",
    description: "CREATE TABLE",
  },
  {
    prefix: "cti",
    body: "CREATE INDEX ${1:idx_name} ON ${2:table_name} (${3:column});",
    description: "CREATE INDEX",
  },
  {
    prefix: "ctiu",
    body: "CREATE UNIQUE INDEX ${1:idx_name} ON ${2:table_name} (${3:column});",
    description: "CREATE UNIQUE INDEX",
  },
  {
    prefix: "at",
    body: "ALTER TABLE ${1:table_name}\nADD COLUMN ${2:column_name} ${3:data_type};",
    description: "ALTER TABLE ADD COLUMN",
  },
  {
    prefix: "atd",
    body: "ALTER TABLE ${1:table_name}\nDROP COLUMN ${2:column_name};",
    description: "ALTER TABLE DROP COLUMN",
  },
  {
    prefix: "dt",
    body: "DROP TABLE IF EXISTS ${1:table_name};",
    description: "DROP TABLE",
  },

  // CTEs and subqueries
  {
    prefix: "cte",
    body: "WITH ${1:cte_name} AS (\n  SELECT ${2:columns}\n  FROM ${3:table}\n  WHERE ${4:condition}\n)\nSELECT * FROM ${1:cte_name};",
    description: "Common Table Expression",
  },
  {
    prefix: "ctem",
    body: "WITH\n  ${1:cte1} AS (\n    SELECT ${2:columns} FROM ${3:table1}\n  ),\n  ${4:cte2} AS (\n    SELECT ${5:columns} FROM ${6:table2}\n  )\nSELECT * FROM ${1:cte1}\nJOIN ${4:cte2} ON ${7:condition};",
    description: "Multiple CTEs",
  },
  {
    prefix: "rcte",
    body: "WITH RECURSIVE ${1:cte_name} AS (\n  -- Base case\n  SELECT ${2:columns}\n  FROM ${3:table}\n  WHERE ${4:base_condition}\n  \n  UNION ALL\n  \n  -- Recursive case\n  SELECT ${5:columns}\n  FROM ${3:table} t\n  JOIN ${1:cte_name} c ON ${6:recursive_condition}\n)\nSELECT * FROM ${1:cte_name};",
    description: "Recursive CTE",
  },

  // Window functions
  {
    prefix: "rown",
    body: "ROW_NUMBER() OVER (PARTITION BY ${1:column} ORDER BY ${2:column}) as row_num",
    description: "ROW_NUMBER window function",
  },
  {
    prefix: "rank",
    body: "RANK() OVER (PARTITION BY ${1:column} ORDER BY ${2:column}) as rank",
    description: "RANK window function",
  },
  {
    prefix: "lag",
    body: "LAG(${1:column}, ${2:1}) OVER (PARTITION BY ${3:partition_column} ORDER BY ${4:order_column}) as prev_value",
    description: "LAG window function",
  },
  {
    prefix: "lead",
    body: "LEAD(${1:column}, ${2:1}) OVER (PARTITION BY ${3:partition_column} ORDER BY ${4:order_column}) as next_value",
    description: "LEAD window function",
  },

  // Transactions
  {
    prefix: "tx",
    body: "BEGIN;\n\n${1:-- SQL statements}\n\nCOMMIT;",
    description: "Transaction block",
  },
  {
    prefix: "txr",
    body: "BEGIN;\n\n${1:-- SQL statements}\n\nROLLBACK;",
    description: "Transaction with rollback",
  },

  // Functions (PostgreSQL)
  {
    prefix: "fn",
    body: "CREATE OR REPLACE FUNCTION ${1:function_name}(${2:params})\nRETURNS ${3:return_type}\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  ${4:-- function body}\n  RETURN ${5:value};\nEND;\n$$;",
    description: "CREATE FUNCTION (PL/pgSQL)",
  },

  // Views
  {
    prefix: "cv",
    body: "CREATE OR REPLACE VIEW ${1:view_name} AS\nSELECT ${2:columns}\nFROM ${3:table}\nWHERE ${4:condition};",
    description: "CREATE VIEW",
  },
  {
    prefix: "cmv",
    body: "CREATE MATERIALIZED VIEW ${1:view_name} AS\nSELECT ${2:columns}\nFROM ${3:table}\nWHERE ${4:condition}\nWITH DATA;",
    description: "CREATE MATERIALIZED VIEW",
  },

  // Case/conditional
  {
    prefix: "case",
    body: "CASE\n  WHEN ${1:condition1} THEN ${2:result1}\n  WHEN ${3:condition2} THEN ${4:result2}\n  ELSE ${5:default}\nEND",
    description: "CASE expression",
  },
  {
    prefix: "casec",
    body: "CASE ${1:column}\n  WHEN ${2:value1} THEN ${3:result1}\n  WHEN ${4:value2} THEN ${5:result2}\n  ELSE ${6:default}\nEND",
    description: "CASE column expression",
  },
  {
    prefix: "coal",
    body: "COALESCE(${1:column}, ${2:default})",
    description: "COALESCE",
  },
  {
    prefix: "nullif",
    body: "NULLIF(${1:column}, ${2:value})",
    description: "NULLIF",
  },

  // Explain
  {
    prefix: "exp",
    body: "EXPLAIN ANALYZE\n${1:query}",
    description: "EXPLAIN ANALYZE",
  },
  {
    prefix: "expv",
    body: "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)\n${1:query}",
    description: "EXPLAIN ANALYZE verbose",
  },
];

/**
 * Parse snippet body and extract tab stops
 */
function parseSnippetBody(
  body: string,
  insertPos: number
): { text: string; tabStops: TabStop[] } {
  const tabStops: TabStop[] = [];
  let offset = 0;

  const text = body.replace(TAB_STOP_REGEX, (_match, index1, index2, placeholder) => {
    const index = parseInt(index1 || index2, 10);
    const defaultText = placeholder || "";
    const from = insertPos + offset;
    const to = from + defaultText.length;

    tabStops.push({ index, from, to, placeholder: defaultText });
    offset += defaultText.length;

    return defaultText;
  });

  // Sort by index
  tabStops.sort((a, b) => a.index - b.index);

  return { text, tabStops };
}

/**
 * Find matching snippet at cursor
 */
function findSnippetAtCursor(
  state: EditorState,
  snippets: Snippet[]
): { snippet: Snippet; from: number; to: number } | null {
  const { head } = state.selection.main;
  const line = state.doc.lineAt(head);
  const lineText = line.text.slice(0, head - line.from);

  // Match word at cursor
  const wordMatch = lineText.match(/(\w+)$/);
  if (!wordMatch || !wordMatch[1]) return null;

  const prefix = wordMatch[1];
  const from = head - prefix.length;
  const to = head;

  // Find matching snippet
  const snippet = snippets.find(
    (s) => s.prefix.toLowerCase() === prefix.toLowerCase()
  );

  if (!snippet) return null;

  return { snippet, from, to };
}

/**
 * Expand snippet at cursor
 */
function expandSnippet(view: EditorView, snippets: Snippet[]): boolean {
  const match = findSnippetAtCursor(view.state, snippets);
  if (!match) return false;

  const { snippet, from, to } = match;
  const { text, tabStops } = parseSnippetBody(snippet.body, from);

  // Calculate end position
  const endPos = from + text.length;

  // Create active snippet session
  const activeSnippet: ActiveSnippet | null =
    tabStops.length > 0
      ? { tabStops, currentIndex: tabStops[0]?.index ?? 0, endPos }
      : null;

  // Build transaction
  const changes = { from, to, insert: text };
  const effects: StateEffect<unknown>[] = [];

  if (activeSnippet) {
    effects.push(setActiveSnippet.of(activeSnippet));
  }

  // Select first tab stop
  const firstStop = tabStops[0];
  const selection = firstStop
    ? { anchor: firstStop.from, head: firstStop.to }
    : { anchor: from + text.length };

  view.dispatch({
    changes,
    selection,
    effects,
    scrollIntoView: true,
  });

  return true;
}

/**
 * Navigate to next tab stop
 */
function nextTabStop(view: EditorView): boolean {
  const snippet = view.state.field(activeSnippetField);
  if (!snippet) return false;

  const nextIndex = snippet.currentIndex + 1;
  const nextStop = snippet.tabStops.find((s) => s.index === nextIndex);

  if (!nextStop) {
    // Exit snippet mode, move to end
    view.dispatch({
      effects: setActiveSnippet.of(null),
      selection: { anchor: snippet.endPos },
    });
    return true;
  }

  view.dispatch({
    effects: advanceTabStop.of(),
    selection: { anchor: nextStop.from, head: nextStop.to },
  });

  return true;
}

/**
 * Navigate to previous tab stop
 */
function prevTabStop(view: EditorView): boolean {
  const snippet = view.state.field(activeSnippetField);
  if (!snippet) return false;

  const prevIndex = snippet.currentIndex - 1;
  if (prevIndex < 1) return false;

  const prevStop = snippet.tabStops.find((s) => s.index === prevIndex);
  if (!prevStop) return false;

  view.dispatch({
    effects: setActiveSnippet.of({ ...snippet, currentIndex: prevIndex }),
    selection: { anchor: prevStop.from, head: prevStop.to },
  });

  return true;
}

/**
 * Exit snippet mode
 */
function exitSnippetMode(view: EditorView): boolean {
  const snippet = view.state.field(activeSnippetField);
  if (!snippet) return false;

  view.dispatch({
    effects: setActiveSnippet.of(null),
  });

  return true;
}

/**
 * Create snippet extension
 */
export function createSnippetExtension(
  customSnippets: Snippet[] = []
): Extension[] {
  const allSnippets = [...SQL_SNIPPETS, ...customSnippets];

  return [
    activeSnippetField,
    tabStopDecorations,
    keymap.of([
      // Tab to expand snippet or go to next tab stop
      {
        key: "Tab",
        run: (view) => {
          // First try to accept autocomplete
          if (acceptCompletion(view)) return true;

          // Check if in snippet mode
          const snippet = view.state.field(activeSnippetField);
          if (snippet) {
            return nextTabStop(view);
          }

          // Try to expand snippet
          return expandSnippet(view, allSnippets);
        },
      },
      // Shift+Tab to go to previous tab stop
      {
        key: "Shift-Tab",
        run: prevTabStop,
      },
      // Escape to exit snippet mode
      {
        key: "Escape",
        run: (view) => {
          // Exit snippet mode if active
          if (exitSnippetMode(view)) return true;
          return false;
        },
      },
    ]),
    // Snippet mode styling
    EditorView.baseTheme({
      ".cm-snippet-tabstop": {
        backgroundColor: "rgba(212, 165, 43, 0.2)",
        borderRadius: "2px",
      },
    }),
  ];
}

/**
 * Get snippet by prefix
 */
export function getSnippetByPrefix(
  prefix: string,
  customSnippets: Snippet[] = []
): Snippet | undefined {
  const allSnippets = [...SQL_SNIPPETS, ...customSnippets];
  return allSnippets.find(
    (s) => s.prefix.toLowerCase() === prefix.toLowerCase()
  );
}

/**
 * Get all available snippets
 */
export function getAllSnippets(customSnippets: Snippet[] = []): Snippet[] {
  return [...SQL_SNIPPETS, ...customSnippets];
}
