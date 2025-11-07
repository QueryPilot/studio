/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { type Action } from "@codemirror/lint";
import { type EditorView } from "@codemirror/view";
import { type DBMLDiagnostic } from "./dbml-linter";
import { ValidationCode } from "./dbml-validator";

export interface QuickFix {
  title: string;
  apply: (view: EditorView, diagnostic: DBMLDiagnostic) => void;
}

export class QuickFixProvider {
  getQuickFixes(diagnostic: DBMLDiagnostic, view: EditorView): Action[] {
    const fixes: Action[] = [];

    switch (diagnostic.code) {
      case ValidationCode.UNDEFINED_TABLE:
        fixes.push(...this.getUndefinedTableFixes(diagnostic, view));
        break;

      case ValidationCode.UNDEFINED_COLUMN:
        fixes.push(...this.getUndefinedColumnFixes(diagnostic, view));
        break;

      case ValidationCode.MISSING_PRIMARY_KEY:
        fixes.push(this.getAddPrimaryKeyFix(diagnostic, view));
        break;

      case ValidationCode.MISSING_INDEXES:
        fixes.push(this.getAddIndexFix(diagnostic, view));
        break;

      case ValidationCode.MISSING_TABLE_NOTE:
        fixes.push(this.getAddTableNoteFix(diagnostic, view));
        break;

      case ValidationCode.INCONSISTENT_NAMING:
        fixes.push(this.getRenameFix(diagnostic, view));
        break;

      case ValidationCode.DUPLICATE_PRIMARY_KEY:
        fixes.push(this.getConvertToCompositePKFix(diagnostic, view));
        break;

      case ValidationCode.RESERVED_KEYWORD:
        fixes.push(this.getEscapeKeywordFix(diagnostic, view));
        break;
    }

    return fixes;
  }

  private getUndefinedTableFixes(
    diagnostic: DBMLDiagnostic,
    _view: EditorView,
  ): Action[] {
    const fixes: Action[] = [];
    const { tableName, suggestions } = diagnostic.data || {};

    // Suggest similar tables
    if (suggestions && suggestions.length > 0) {
      for (const suggestion of suggestions.slice(0, 3)) {
        fixes.push({
          name: `Change to '${suggestion}'`,
          apply: (view) => {
            view.dispatch({
              changes: {
                from: diagnostic.from,
                to: diagnostic.to,
                insert: suggestion,
              },
            });
          },
        });
      }
    }

    // Create table
    if (tableName) {
      fixes.push({
        name: `Create table '${tableName}'`,
        apply: (view) => {
          const insertion = `\n\nTable ${tableName} {\n  id integer [pk, increment]\n  created_at timestamp [default: \`now()\`]\n  updated_at timestamp [default: \`now()\`]\n}\n`;
          view.dispatch({
            changes: {
              from: view.state.doc.length,
              insert: insertion,
            },
            selection: {
              anchor:
                view.state.doc.length + insertion.indexOf("updated_at") + 10,
            },
          });
        },
      });
    }

    return fixes;
  }

  private getUndefinedColumnFixes(
    diagnostic: DBMLDiagnostic,
    _view: EditorView,
  ): Action[] {
    const fixes: Action[] = [];
    const { tableName, columnName, suggestions } = diagnostic.data || {};

    // Suggest similar columns
    if (suggestions && suggestions.length > 0) {
      for (const suggestion of suggestions.slice(0, 3)) {
        fixes.push({
          name: `Change to '${suggestion}'`,
          apply: (view) => {
            view.dispatch({
              changes: {
                from: diagnostic.from,
                to: diagnostic.to,
                insert: suggestion,
              },
            });
          },
        });
      }
    }

    // Add column to table
    if (tableName && columnName) {
      fixes.push({
        name: `Add column '${columnName}' to table '${tableName}'`,
        apply: (view) => {
          const doc = view.state.doc.toString();
          const tableRegex = new RegExp(
            `Table\\s+${tableName}\\s*\\{([^}]*)\\}`,
            "s",
          );
          const match = doc.match(tableRegex);

          if (match) {
            // const _tableContent = match[1]; // unused
            const lastColumnEnd = match.index ?? 0 + match[0].lastIndexOf("}");
            const insertion = `  ${columnName} integer\n`;

            view.dispatch({
              changes: {
                from: lastColumnEnd,
                insert: insertion,
              },
            });
          }
        },
      });
    }

    return fixes;
  }

  private getAddPrimaryKeyFix(
    diagnostic: DBMLDiagnostic,
    _view: EditorView,
  ): Action {
    const { tableName } = diagnostic.data || {};

    return {
      name: `Add primary key to '${tableName}'`,
      apply: (view) => {
        const doc = view.state.doc.toString();
        const tableRegex = new RegExp(
          `Table\\s+${tableName}\\s*\\{([^}]*)\\}`,
          "s",
        );
        const match = doc.match(tableRegex);

        if (match) {
          const tableStart = match.index ?? 0 + match[0].indexOf("{") + 1;
          const insertion = `\n  id integer [pk, increment]`;

          view.dispatch({
            changes: {
              from: tableStart,
              insert: insertion,
            },
          });
        }
      },
    };
  }

  private getAddIndexFix(
    diagnostic: DBMLDiagnostic,
    _view: EditorView,
  ): Action {
    const { tableName, columns } = diagnostic.data || {};

    return {
      name: `Add index on [${columns?.join(", ")}]`,
      apply: (view) => {
        const doc = view.state.doc.toString();
        const tableRegex = new RegExp(
          `Table\\s+${tableName}\\s*\\{([^}]*)\\}`,
          "s",
        );
        const match = doc.match(tableRegex);

        if (match) {
          const tableContent = match[1]!;
          const hasIndexBlock = tableContent.includes("indexes {");

          if (hasIndexBlock) {
            // Add to existing indexes block
            const indexMatch = tableContent.match(/indexes\s*\{([^}]*)\}/);
            if (indexMatch) {
              const indexBlockEnd =
                match.index ??
                0 +
                  match[0].indexOf("indexes") +
                  indexMatch[0].lastIndexOf("}");
              const insertion = `    ${columns?.join(", ")}\n`;

              view.dispatch({
                changes: {
                  from: indexBlockEnd,
                  insert: insertion,
                },
              });
            }
          } else {
            // Add new indexes block
            const tableEnd = match.index ?? 0 + match[0].lastIndexOf("}");
            const insertion = `\n  indexes {\n    ${columns?.join(
              ", ",
            )}\n  }\n`;

            view.dispatch({
              changes: {
                from: tableEnd,
                insert: insertion,
              },
            });
          }
        }
      },
    };
  }

  private getAddTableNoteFix(
    diagnostic: DBMLDiagnostic,
    _view: EditorView,
  ): Action {
    const { tableName } = diagnostic.data || {};

    return {
      name: `Add documentation to '${tableName}'`,
      apply: (view) => {
        const doc = view.state.doc.toString();
        const tableRegex = new RegExp(
          `Table\\s+${tableName}\\s*\\{([^}]*)\\}`,
          "s",
        );
        const match = doc.match(tableRegex);

        if (match) {
          const tableContent = match[1]!;
          const hasNote = tableContent.includes("Note:");

          if (!hasNote) {
            const tableEnd = match.index ?? 0 + match[0].lastIndexOf("}");
            const insertion = `\n  Note: 'TODO: Add table description'`;

            view.dispatch({
              changes: {
                from: tableEnd,
                insert: insertion,
              },
              selection: {
                anchor: tableEnd + insertion.indexOf("TODO"),
                head:
                  tableEnd +
                  insertion.indexOf("TODO") +
                  "TODO: Add table description".length,
              },
            });
          }
        }
      },
    };
  }

  private getRenameFix(diagnostic: DBMLDiagnostic, _view: EditorView): Action {
    const { tableName, suggestedName } = diagnostic.data || {};

    return {
      name: `Rename to '${suggestedName}'`,
      apply: (view) => {
        const doc = view.state.doc.toString();
        const regex = new RegExp(`\\b${tableName}\\b`, "g");
        const changes: { from: number; to: number; insert: string }[] = [];

        let match;
        while ((match = regex.exec(doc)) !== null) {
          const matchIndex = match.index;
          changes.push({
            from: matchIndex,
            to: matchIndex + (tableName as string).length,
            insert: suggestedName as string,
          });
        }

        if (changes.length > 0) {
          view.dispatch({ changes });
        }
      },
    };
  }

  private getConvertToCompositePKFix(
    diagnostic: DBMLDiagnostic,
    _view: EditorView,
  ): Action {
    const { tableName, pkColumns } = diagnostic.data || {};

    return {
      name: `Convert to composite primary key`,
      apply: (view) => {
        const doc = view.state.doc.toString();
        const tableRegex = new RegExp(
          `Table\\s+${tableName}\\s*\\{([^}]*)\\}`,
          "s",
        );
        const match = doc.match(tableRegex);

        if (match) {
          let tableContent = match[1]!;
          const tableStart = match.index ?? 0 + match[0].indexOf("{") + 1;

          // Remove [pk] from individual columns
          for (const colName of pkColumns || []) {
            tableContent = tableContent.replace(
              new RegExp(
                `(${colName}[^\\[\\n]*\\[)([^\\]]*\\bpk\\b[^\\]]*)\\]`,
                "g",
              ),
              (_match, prefix, settings) => {
                const newSettings = settings
                  .replace(/\bpk\b,?\s*/, "")
                  .replace(/,\s*$/, "");
                return newSettings
                  ? `${prefix}${newSettings}]`
                  : prefix.slice(0, -1);
              },
            );
          }

          // Add composite key to indexes
          const hasIndexBlock = tableContent.includes("indexes {");
          if (hasIndexBlock) {
            tableContent = tableContent.replace(
              /indexes\s*\{([^}]*)\}/,
              (_match, content) =>
                `indexes {${content}    (${pkColumns?.join(", ")}) [pk]\n  }`,
            );
          } else {
            const insertion = `\n  indexes {\n    (${pkColumns?.join(
              ", ",
            )}) [pk]\n  }`;
            tableContent = tableContent.trimEnd() + insertion;
          }

          view.dispatch({
            changes: {
              from: tableStart,
              to: match.index ?? 0 + match[0].lastIndexOf("}"),
              insert: tableContent,
            },
          });
        }
      },
    };
  }

  private getEscapeKeywordFix(
    diagnostic: DBMLDiagnostic,
    _view: EditorView,
  ): Action {
    const { name, type: _type } = diagnostic.data || {};

    return {
      name: `Quote '${name}' to escape keyword`,
      apply: (view) => {
        const quotedName = `"${name}"`;
        view.dispatch({
          changes: {
            from: diagnostic.from,
            to: diagnostic.to,
            insert: quotedName,
          },
        });
      },
    };
  }
}

// Export helper function to attach quick fixes to diagnostics
export function attachQuickFixes(
  diagnostics: DBMLDiagnostic[],
  view: EditorView,
): DBMLDiagnostic[] {
  const provider = new QuickFixProvider();

  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    actions: provider.getQuickFixes(diagnostic, view),
  }));
}
