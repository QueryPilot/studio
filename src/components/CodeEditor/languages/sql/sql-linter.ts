import { syntaxTree } from "@codemirror/language";
import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension, EditorState } from "@codemirror/state";

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "HAVING",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "ON",
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "VALUES",
  "RETURNING",
  "WITH",
  "DISTINCT",
  "UNION",
  "EXCEPT",
  "INTERSECT",
];

const UPPERCASE_IDENTIFIER = /^[A-Z_]+$/;

const levenshtein = (a: string, b: string): number => {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1]?.[j - 1] ?? 0;
        continue;
      }

      const substitution = (matrix[i - 1]?.[j - 1] ?? 0) + 1;
      const insertion = (matrix[i]?.[j - 1] ?? 0) + 1;
      const deletion = (matrix[i - 1]?.[j] ?? 0) + 1;

      matrix[i][j] = Math.min(substitution, insertion, deletion);
    }
  }

  return matrix[b.length]?.[a.length] ?? 0;
};

const suggestKeyword = (identifier: string): string | null => {
  if (!identifier || identifier.length < 3) return null;
  if (identifier !== identifier.toUpperCase()) return null;
  if (!UPPERCASE_IDENTIFIER.test(identifier)) return null;

  let best: { keyword: string; distance: number } | null = null;

  for (const keyword of SQL_KEYWORDS) {
    if (identifier.length > keyword.length) continue;
    if (identifier[0] !== keyword[0]) continue;

    const distance = levenshtein(identifier, keyword);
    if (distance > 1) continue;

    if (!best || distance < best.distance) {
      best = { keyword, distance };
      if (distance === 0) break;
    }
  }

  return best?.distance === 0 ? null : best?.keyword ?? null;
};

const MAX_SNIPPET_LENGTH = 24;

const toSnippet = (state: EditorState, from: number, to: number): string => {
  const doc = state.doc;
  let raw = doc.sliceString(from, Math.min(doc.length, to));

  if (!raw.trim()) {
    const contextFrom = Math.max(0, from - 12);
    raw = doc.sliceString(contextFrom, Math.min(doc.length, from + 12));
  }

  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return "token";

  if (normalized.length > MAX_SNIPPET_LENGTH) {
    return `${normalized.slice(0, MAX_SNIPPET_LENGTH - 1)}…`;
  }

  return normalized;
};

const collectDiagnostics = (state: EditorState): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const tree = syntaxTree(state);

  tree.iterate({
    enter: (node) => {
      if (node.type.isError) {
        const from = node.from;
        const to = node.to > node.from ? node.to : Math.min(state.doc.length, node.from + 1);

        diagnostics.push({
          from,
          to,
          severity: "error",
          message: `Syntax error near "${toSnippet(state, from, to)}"`,
        });
        return;
      }

      if (node.type.name === "Identifier") {
        const text = state.doc.sliceString(node.from, node.to);
        const suggestion = suggestKeyword(text);
        if (!suggestion) return;

        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "warning",
          message: `Unknown keyword "${text}". Did you mean "${suggestion}"?`,
          actions: [
            {
              name: `Replace with ${suggestion}`,
              apply(view, from, to) {
                view.dispatch({ changes: { from, to, insert: suggestion } });
              },
            },
          ],
        });
      }
    },
  });

  if (!diagnostics.length) return diagnostics;

  const deduped: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const diag of diagnostics) {
    const key = `${diag.from}-${diag.to}-${diag.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(diag);
  }

  return deduped;
};

export const createSqlLinter = (): Extension =>
  linter((view) => collectDiagnostics(view.state), {
    delay: 400,
    needsRefresh: (update) => update.docChanged,
  });
