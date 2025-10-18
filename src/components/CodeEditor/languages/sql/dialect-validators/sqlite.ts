import type { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";
import { AbstractDialectValidator, type SuppressionPattern } from "./base";

/**
 * SQLite dialect validator
 * Handles SQLite-specific syntax including:
 * - AUTOINCREMENT (not AUTO_INCREMENT)
 * - SQLite-specific pragmas
 * - Limited type system
 */
export class SQLiteValidator extends AbstractDialectValidator {
  readonly dialect = "sqlite" as const;

  getSuppressionPatterns(): SuppressionPattern[] {
    return [
      {
        pattern: /\bAUTOINCREMENT\b/i,
        reason: "SQLite AUTOINCREMENT keyword",
      },
      {
        pattern: /\bPRAGMA\s+\w+/i,
        reason: "SQLite PRAGMA statement",
      },
      {
        pattern: /\bON\s+CONFLICT\s+(?:ROLLBACK|ABORT|FAIL|IGNORE|REPLACE)\b/i,
        reason: "SQLite ON CONFLICT clause",
      },
      {
        pattern: /\bWITHOUT\s+ROWID\b/i,
        reason: "SQLite WITHOUT ROWID table option",
      },
      {
        pattern: /\bSTRICT\b/i,
        reason: "SQLite STRICT table option",
      },
      {
        pattern: /\bGENERATED\s+ALWAYS\s+AS\b/i,
        reason: "SQLite generated column",
      },
      {
        pattern: /\bVIRTUAL\b/i,
        reason: "SQLite virtual column",
      },
      {
        pattern: /\bSTORED\b/i,
        reason: "SQLite stored column",
      },
      {
        pattern: /\bGLOB\b/i,
        reason: "SQLite GLOB operator",
      },
      {
        pattern: /\bMATCH\b/i,
        reason: "SQLite MATCH operator",
      },
      {
        pattern: /\bREGEXP\b/i,
        reason: "SQLite REGEXP operator",
      },
      {
        pattern: /\bATTACH\s+DATABASE\b/i,
        reason: "SQLite ATTACH DATABASE statement",
      },
      {
        pattern: /\bDETACH\s+DATABASE\b/i,
        reason: "SQLite DETACH DATABASE statement",
      },
      {
        pattern: /\bVACUUM\b/i,
        reason: "SQLite VACUUM command",
      },
      {
        pattern: /\bANALYZE\b/i,
        reason: "SQLite ANALYZE command",
      },
      {
        pattern: /\bREINDEX\b/i,
        reason: "SQLite REINDEX command",
      },
    ];
  }

  validateDialectSyntax(state: EditorState): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const doc = state.doc.toString();

    // Check for MySQL-style AUTO_INCREMENT (common mistake)
    const autoIncrementPattern = /\bAUTO_INCREMENT\b/gi;
    let match;

    while ((match = autoIncrementPattern.exec(doc)) !== null) {
      diagnostics.push({
        from: match.index,
        to: match.index + match[0].length,
        severity: "error",
        message:
          "SQLite uses AUTOINCREMENT (not AUTO_INCREMENT). Note: PRIMARY KEY columns are auto-incrementing by default.",
        actions: [
          {
            name: "Replace with AUTOINCREMENT",
            apply(view, from, to) {
              view.dispatch({
                changes: { from, to, insert: "AUTOINCREMENT" },
              });
            },
          },
        ],
      });
    }

    // Check for unsupported features
    const alterTableRename = /\bALTER\s+TABLE\s+\w+\s+RENAME\s+COLUMN\b/gi;
    while ((match = alterTableRename.exec(doc)) !== null) {
      diagnostics.push({
        from: match.index,
        to: match.index + match[0].length,
        severity: "warning",
        message: "RENAME COLUMN is only supported in SQLite 3.25.0 and later",
      });
    }

    return diagnostics;
  }

  validateBestPractices(state: EditorState): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const doc = state.doc.toString();

    // Suggest STRICT tables for better type safety (SQLite 3.37.0+)
    const createTablePattern =
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
    let match;

    while ((match = createTablePattern.exec(doc)) !== null) {
      const tableDefEnd = this.findTableDefinitionEnd(doc, match.index);
      if (tableDefEnd !== -1) {
        const tableDef = doc.slice(match.index, tableDefEnd);
        if (!/\bSTRICT\b/i.test(tableDef) && match[1]) {
          diagnostics.push({
            from: match.index,
            to: tableDefEnd,
            severity: "info",
            message:
              "Consider using STRICT tables (SQLite 3.37+) for better type safety",
          });
        }
      }
    }

    return diagnostics;
  }

  private findTableDefinitionEnd(doc: string, start: number): number {
    let parenDepth = 0;
    let inDef = false;

    for (let i = start; i < doc.length; i++) {
      const char = doc[i];

      if (char === "(") {
        parenDepth++;
        inDef = true;
      } else if (char === ")") {
        parenDepth--;
        if (inDef && parenDepth === 0) {
          // Look for semicolon or end
          for (let j = i + 1; j < Math.min(i + 50, doc.length); j++) {
            const char = doc[j];
            if (!char) continue;
            if (char === ";") {
              return j + 1;
            }
            if (!/\s/.test(char)) {
              return i + 1;
            }
          }
          return i + 1;
        }
      }
    }

    return -1;
  }
}
