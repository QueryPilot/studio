/**
 * SQL Code Actions
 *
 * Provides code actions like "Expand Star" for SQL queries.
 */

import { StateField, type Extension } from "@codemirror/state";
import {
  type EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { MetadataProvider } from "../../types";

interface StarExpansionTarget {
  from: number;
  to: number;
  tables: Array<{ name: string; schema?: string; alias?: string }>;
}

/**
 * Find all SELECT * patterns in the document
 */
function findStarPatterns(view: EditorView): StarExpansionTarget[] {
  const targets: StarExpansionTarget[] = [];
  const content = view.state.doc.toString();

  // Use regex to find SELECT * patterns
  // Match: SELECT *, SELECT DISTINCT *, or SELECT ALL *
  const starPattern = /\bSELECT\s+(?:DISTINCT\s+|ALL\s+)?\*\s+FROM\s+/gi;
  let match;

  while ((match = starPattern.exec(content)) !== null) {
    const selectStart = match.index;
    const starPos = content.indexOf("*", selectStart);

    if (starPos === -1) continue;

    // Find the FROM clause to extract tables
    const afterStar = content.slice(starPos + 1);
    const fromMatch = afterStar.match(/^\s*FROM\s+/i);
    if (!fromMatch) continue;

    const tablesStart = starPos + 1 + fromMatch[0].length;

    // Extract table names (simplified - handle schema.table, aliases)
    const tables = extractTablesFromFrom(content, tablesStart);

    if (tables.length > 0) {
      targets.push({
        from: starPos,
        to: starPos + 1,
        tables,
      });
    }
  }

  return targets;
}

/**
 * Extract table references from FROM clause
 */
function extractTablesFromFrom(
  content: string,
  startPos: number,
): Array<{ name: string; schema?: string; alias?: string }> {
  const tables: Array<{ name: string; schema?: string; alias?: string }> = [];

  // Simple extraction - find identifiers until we hit WHERE, ORDER, GROUP, LIMIT, UNION, etc.
  const remaining = content.slice(startPos);
  const endMatch = remaining.match(
    /\b(WHERE|ORDER|GROUP|HAVING|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|;|\))/i,
  );
  const tablesPart = endMatch ? remaining.slice(0, endMatch.index) : remaining;

  // Split by comma for multiple tables, handle JOINs
  const parts = tablesPart.split(/,|\bJOIN\b/i);

  for (const part of parts) {
    const cleaned = part
      .trim()
      .replace(/\b(INNER|LEFT|RIGHT|FULL|OUTER|CROSS|ON\s+.*$)/gi, "")
      .trim();

    if (!cleaned) continue;

    // Parse: [schema.]table [AS] [alias]
    // Handle quoted identifiers: "table", `table`, [table]
    const tableMatch = cleaned.match(
      /^(?:(["\w`[\]]+)\.)?(["\w`[\]]+)(?:\s+(?:AS\s+)?(["\w`[\]]+))?$/i,
    );

    if (tableMatch) {
      // Remove quotes from captured groups
      const stripQuotes = (s?: string) => s?.replace(/["`[\]]/g, "");
      tables.push({
        schema: stripQuotes(tableMatch[1]),
        name: stripQuotes(tableMatch[2]) || "",
        alias: stripQuotes(tableMatch[3]),
      });
    }
  }

  return tables;
}

/**
 * Quote identifier based on SQL dialect
 */
function quoteIdentifier(name: string, dialect: string): string {
  switch (dialect) {
    case "mysql":
      return `\`${name}\``;
    case "mssql":
      return `[${name}]`;
    case "postgresql":
    case "sqlite":
    default:
      return `"${name}"`;
  }
}

/**
 * Create the Expand Star code action extension
 */
export function createExpandStarExtension(
  provider: MetadataProvider,
  defaultSchema: string,
  dialect: string = "postgresql",
): Extension {
  // Widget decoration for the expand button
  const expandWidget = (target: StarExpansionTarget) => {
    return Decoration.widget({
      widget: new ExpandStarWidget(target, provider, defaultSchema, dialect),
      side: 1,
    });
  };

  // Create decorations for star patterns
  const decorationField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(decorations, tr) {
      // Always recompute on doc changes
      if (tr.docChanged) {
        return Decoration.none;
      }
      return decorations;
    },
  });

  // View plugin to add expand buttons
  const expandPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;

      constructor(view: EditorView) {
        this.updateDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.updateDecorations(update.view);
        }
      }

      updateDecorations(view: EditorView) {
        const targets = findStarPatterns(view);
        const decos: Array<{ from: number; value: Decoration }> = [];

        for (const target of targets) {
          // Only show in viewport
          if (
            target.from < view.viewport.from ||
            target.from > view.viewport.to
          ) {
            continue;
          }
          decos.push({
            from: target.to,
            value: expandWidget(target),
          });
        }

        this.decorations = Decoration.set(
          decos.map((d) => d.value.range(d.from)),
          true,
        );
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );

  return [decorationField, expandPlugin];
}

/**
 * Widget for the expand star button
 */
class ExpandStarWidget extends WidgetType {
  constructor(
    private target: StarExpansionTarget,
    private provider: MetadataProvider,
    private defaultSchema: string,
    private dialect: string = "postgresql",
  ) {
    super();
  }

  eq(other: ExpandStarWidget) {
    return (
      this.target.from === other.target.from &&
      this.target.to === other.target.to
    );
  }

  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.className = "cm-expand-star-btn";
    button.textContent = "⤢";
    button.title = "Expand * to column names";
    button.style.cssText = `
      font-size: 12px;
      padding: 0 3px;
      margin-left: 2px;
      background: var(--cm-expand-star-bg, hsl(var(--muted)));
      border: 1px solid var(--cm-expand-star-border, hsl(var(--border)));
      border-radius: calc(var(--radius) - 4px);
      cursor: pointer;
      color: var(--cm-expand-star-color, hsl(var(--muted-foreground)));
      line-height: 1.2;
      vertical-align: baseline;
      transition: background 0.2s, color 0.2s;
    `;

    button.onmouseenter = () => {
      button.style.background =
        "var(--cm-expand-star-hover-bg, hsl(var(--accent)))";
      button.style.color =
        "var(--cm-expand-star-hover-color, hsl(var(--accent-foreground)))";
    };
    button.onmouseleave = () => {
      button.style.background = "var(--cm-expand-star-bg, hsl(var(--muted)))";
      button.style.color =
        "var(--cm-expand-star-color, hsl(var(--muted-foreground)))";
    };

    button.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await this.expand(view);
    };

    return button;
  }

  private async expand(view: EditorView) {
    try {
      const allColumns: string[] = [];
      const hasMultipleTables = this.target.tables.length > 1;

      for (const table of this.target.tables) {
        const schema = table.schema || this.defaultSchema;
        const fields = await this.provider.listFields(table.name, schema);

        // Always use prefix when multiple tables to avoid ambiguity
        const tableRef = table.alias || table.name;

        for (const field of fields) {
          const quotedColumn = quoteIdentifier(field.name, this.dialect);
          if (hasMultipleTables) {
            // Use alias.column format for JOINs
            const quotedAlias = quoteIdentifier(tableRef, this.dialect);
            allColumns.push(`${quotedAlias}.${quotedColumn}`);
          } else {
            allColumns.push(quotedColumn);
          }
        }
      }

      if (allColumns.length === 0) {
        console.warn(
          "[ExpandStar] No columns found for tables:",
          this.target.tables,
        );
        return;
      }

      // Format columns nicely
      const columnsText =
        allColumns.length > 3
          ? "\n  " + allColumns.join(",\n  ") + "\n"
          : allColumns.join(", ");

      // Replace * with expanded columns
      view.dispatch({
        changes: {
          from: this.target.from,
          to: this.target.to,
          insert: columnsText,
        },
      });
    } catch (error) {
      console.error("[ExpandStar] Error expanding:", error);
    }
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * Programmatic API to expand star at a given position
 */
export async function expandStarAtPosition(
  view: EditorView,
  provider: MetadataProvider,
  defaultSchema: string,
  dialect: string = "postgresql",
): Promise<boolean> {
  const targets = findStarPatterns(view);
  const pos = view.state.selection.main.from;

  // Find target containing cursor
  const target = targets.find((t) => pos >= t.from && pos <= t.to + 20);
  if (!target) return false;

  try {
    const allColumns: string[] = [];
    const hasMultipleTables = target.tables.length > 1;

    for (const table of target.tables) {
      const schema = table.schema || defaultSchema;
      const fields = await provider.listFields(table.name, schema);

      const tableRef = table.alias || table.name;

      for (const field of fields) {
        const quotedColumn = quoteIdentifier(field.name, dialect);
        if (hasMultipleTables) {
          const quotedAlias = quoteIdentifier(tableRef, dialect);
          allColumns.push(`${quotedAlias}.${quotedColumn}`);
        } else {
          allColumns.push(quotedColumn);
        }
      }
    }

    if (allColumns.length === 0) return false;

    const columnsText =
      allColumns.length > 3
        ? "\n  " + allColumns.join(",\n  ") + "\n"
        : allColumns.join(", ");

    view.dispatch({
      changes: {
        from: target.from,
        to: target.to,
        insert: columnsText,
      },
    });

    return true;
  } catch (error) {
    console.error("[ExpandStar] Error:", error);
    return false;
  }
}
