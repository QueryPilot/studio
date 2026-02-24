import { type Action, type Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";

type Range = { from: number; to: number };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isIdentifierBoundary(ch: string | undefined): boolean {
  if (!ch) return true;
  return !/[A-Za-z0-9_]/.test(ch);
}

function findIdentifierRangeInScope(
  doc: string,
  scope: Range,
  identifier: string,
): Range | null {
  const from = Math.max(0, scope.from);
  const to = Math.min(doc.length, scope.to);
  if (from >= to || !identifier) {
    return null;
  }

  const scoped = doc.slice(from, to);
  const needleLower = identifier.toLowerCase();
  const scopedLower = scoped.toLowerCase();

  // First, try exact unquoted identifier with identifier boundaries.
  let idx = scopedLower.indexOf(needleLower);
  while (idx !== -1) {
    const before = scoped[idx - 1];
    const after = scoped[idx + identifier.length];
    if (isIdentifierBoundary(before) && isIdentifierBoundary(after)) {
      return { from: from + idx, to: from + idx + identifier.length };
    }
    idx = scopedLower.indexOf(needleLower, idx + 1);
  }

  // Then, try quoted variants.
  const quotedPatterns = [`"${identifier}"`, `\`${identifier}\``, `[${identifier}]`];
  for (const candidate of quotedPatterns) {
    const scopedCandidateIdx = scopedLower.indexOf(candidate.toLowerCase());
    if (scopedCandidateIdx !== -1) {
      return {
        from: from + scopedCandidateIdx,
        to: from + scopedCandidateIdx + candidate.length,
      };
    }
  }

  return null;
}

function replaceRange(view: EditorView, range: Range, replacement: string): void {
  view.dispatch({
    changes: {
      from: range.from,
      to: range.to,
      insert: replacement,
    },
  });
}

function buildSuggestionFix(
  diagnostic: Diagnostic,
  current: string,
  suggested: string,
): Action {
  return {
    name: `Change to '${suggested}'`,
    apply: (view) => {
      const doc = view.state.doc.toString();
      const scope = { from: diagnostic.from, to: diagnostic.to };
      const hit = findIdentifierRangeInScope(doc, scope, current);
      if (!hit) {
        return;
      }
      replaceRange(view, hit, suggested);
    },
  };
}

function buildKeywordTypoFix(diagnostic: Diagnostic, suggested: string): Action {
  return {
    name: `Replace with '${suggested}'`,
    apply: (view) => {
      const original = view.state.doc.sliceString(diagnostic.from, diagnostic.to);
      const trailingWhitespace = original.match(/\s+$/)?.[0] ?? "";
      replaceRange(view, { from: diagnostic.from, to: diagnostic.to }, `${suggested}${trailingWhitespace}`);
    },
  };
}

function buildInvalidStarFix(diagnostic: Diagnostic): Action {
  return {
    name: "Insert space after '*'",
    apply: (view) => {
      const original = view.state.doc.sliceString(diagnostic.from, diagnostic.to);
      const fixed = original.replace(/\*([A-Za-z0-9_]+)/, "* $1");
      if (fixed !== original) {
        replaceRange(view, { from: diagnostic.from, to: diagnostic.to }, fixed);
      }
    },
  };
}

function buildMissingOperatorFix(
  diagnostic: Diagnostic,
  left: string,
  right: string,
  suggestion: string,
): Action {
  return {
    name: `Use '${suggestion}'`,
    apply: (view) => {
      const fullDoc = view.state.doc.toString();
      const scoped = fullDoc.slice(diagnostic.from, diagnostic.to);
      const pattern = new RegExp(
        `\\b${escapeRegExp(left)}\\b\\s+${escapeRegExp(right)}\\b`,
        "i",
      );
      const match = pattern.exec(scoped);
      if (!match) {
        return;
      }

      const from = diagnostic.from + match.index;
      const to = from + match[0].length;
      replaceRange(view, { from, to }, suggestion);
    },
  };
}

/**
 * Build SQL quick-fix actions for a diagnostic.
 *
 * The SQL engine currently returns plain-text diagnostics. This parser extracts
 * deterministic fixes for the highest-confidence patterns.
 */
export function buildSqlQuickFixes(diagnostic: Diagnostic): Action[] {
  const message = diagnostic.message;
  const actions: Action[] = [];

  // Pattern: "Possible typo: did you mean 'WHERE'?"
  const keywordTypoMatch = /Possible typo:\s*did you mean '([^']+)'/i.exec(message);
  if (keywordTypoMatch?.[1]) {
    actions.push(buildKeywordTypoFix(diagnostic, keywordTypoMatch[1]));
    return actions;
  }

  // Pattern: "Table/Column/Reference 'x' not found. Did you mean 'y'?"
  const suggestionMatch =
    /^(?:Table|Column|Reference)\s+'([^']+)'.*Did you mean(?: the CTE)?\s+'([^']+)'/i.exec(
      message,
    );
  if (suggestionMatch?.[1] && suggestionMatch[2]) {
    actions.push(
      buildSuggestionFix(diagnostic, suggestionMatch[1], suggestionMatch[2]),
    );
  }

  // Pattern: "Invalid use of '*'. Did you mean to separate this from the identifier?"
  if (message.includes("Invalid use of '*'")) {
    actions.push(buildInvalidStarFix(diagnostic));
  }

  // Pattern: "Missing comparison operator between 'id' and '19'. Did you mean 'id = 19'?"
  const missingOperatorMatch =
    /Missing comparison operator between '([^']+)' and '([^']+)'\.\s*Did you mean '([^']+)'/i.exec(
      message,
    );
  if (
    missingOperatorMatch?.[1] &&
    missingOperatorMatch[2] &&
    missingOperatorMatch[3]
  ) {
    actions.push(
      buildMissingOperatorFix(
        diagnostic,
        missingOperatorMatch[1],
        missingOperatorMatch[2],
        missingOperatorMatch[3],
      ),
    );
  }

  return actions;
}
