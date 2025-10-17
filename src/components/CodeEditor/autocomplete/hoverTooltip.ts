/**
 * Hover Documentation
 * Shows column and table information on hover
 */

import { hoverTooltip } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { schemaCache } from "@/services/schemaCache";
import type { ColumnMeta, TableInfo } from "@/types/database";

interface HoverConfig {
  connectionId: string;
  schema?: string;
  dbType: string;
}

/**
 * Create hover tooltip extension for SQL
 */
export function createSqlHoverTooltip(config: HoverConfig) {
  return hoverTooltip(async (view: EditorView, pos: number) => {
    const { state } = view;
    const word = state.wordAt(pos);
    if (!word) return null;

    const text = state.sliceDoc(word.from, word.to);
    if (!text || text.length < 2) return null;

    // Get text around the word to determine context
    const lineStart = state.doc.lineAt(pos).from;
    const textBefore = state.sliceDoc(lineStart, word.from).toLowerCase();
    const textAfter = state
      .sliceDoc(word.to, Math.min(word.to + 10, state.doc.length))
      .toLowerCase();

    try {
      // Check if it's a qualified reference (table.column)
      if (textBefore.endsWith(".")) {
        // This is a column reference
        const tablePart = state
          .sliceDoc(Math.max(lineStart, word.from - 50), word.from - 1)
          .match(/([a-zA-Z_]\w*)$/);

        if (tablePart) {
          const tableName = tablePart[1];
          const columnName = text;

          const columnInfo = await getColumnHoverInfo(
            config,
            tableName,
            columnName,
          );

          if (columnInfo) {
            return {
              pos: word.from,
              end: word.to,
              above: true,
              create: () => {
                const dom = document.createElement("div");
                dom.className = "cm-hover-tooltip";
                dom.innerHTML = columnInfo;
                return { dom };
              },
            };
          }
        }
      }

      // Check if next character is a dot (this is a table reference)
      else if (textAfter.startsWith(".")) {
        const tableInfo = await getTableHoverInfo(config, text);

        if (tableInfo) {
          return {
            pos: word.from,
            end: word.to,
            above: true,
            create: () => {
              const dom = document.createElement("div");
              dom.className = "cm-hover-tooltip";
              dom.innerHTML = tableInfo;
              return { dom };
            },
          };
        }
      }

      // Try to determine if it's a table or column based on context
      else {
        // Check if it's likely a table name (after FROM, JOIN, etc.)
        const isLikelyTable = /\b(from|join|into|update|table)\s+\w*$/i.test(
          textBefore,
        );

        if (isLikelyTable) {
          const tableInfo = await getTableHoverInfo(config, text);
          if (tableInfo) {
            return {
              pos: word.from,
              end: word.to,
              above: true,
              create: () => {
                const dom = document.createElement("div");
                dom.className = "cm-hover-tooltip";
                dom.innerHTML = tableInfo;
                return { dom };
              },
            };
          }
        }

        // Otherwise, try as a column name
        // We'll need to infer which table it belongs to from context
        // For now, we can try the first table in the query
        const fromMatch = state.doc
          .toString()
          .match(/\bfrom\s+([a-zA-Z_]\w+)/i);
        if (fromMatch) {
          const tableName = fromMatch[1];
          const columnInfo = await getColumnHoverInfo(config, tableName, text);

          if (columnInfo) {
            return {
              pos: word.from,
              end: word.to,
              above: true,
              create: () => {
                const dom = document.createElement("div");
                dom.className = "cm-hover-tooltip";
                dom.innerHTML = columnInfo;
                return { dom };
              },
            };
          }
        }
      }
    } catch (error) {
      console.debug("Hover tooltip error:", error);
    }

    return null;
  });
}

/**
 * Get hover information for a column
 */
async function getColumnHoverInfo(
  config: HoverConfig,
  tableName: string,
  columnName: string,
): Promise<string | null> {
  try {
    const columns = await schemaCache.getTableColumns(
      config.connectionId,
      config.schema || "public",
      tableName,
    );

    const column = columns.find(
      (c) => c.name.toLowerCase() === columnName.toLowerCase(),
    );

    if (!column) return null;

    return formatColumnInfo(column, tableName);
  } catch (error) {
    console.debug("Failed to get column info:", error);
    return null;
  }
}

/**
 * Get hover information for a table
 */
async function getTableHoverInfo(
  config: HoverConfig,
  tableName: string,
): Promise<string | null> {
  try {
    const tables = await schemaCache.getTables(
      config.connectionId,
      config.schema || "public",
    );

    const table = tables.find(
      (t) => t.name.toLowerCase() === tableName.toLowerCase(),
    );

    if (!table) return null;

    // Get column count
    const columns = await schemaCache.getTableColumns(
      config.connectionId,
      config.schema || "public",
      tableName,
    );

    return formatTableInfo(table, columns.length);
  } catch (error) {
    console.debug("Failed to get table info:", error);
    return null;
  }
}

/**
 * Format column information as HTML
 */
function formatColumnInfo(column: ColumnMeta, tableName: string): string {
  const badges: string[] = [];

  if (column.is_pk)
    badges.push('<span class="cm-info-badge cm-badge-pk">PK</span>');
  if (column.is_fk)
    badges.push('<span class="cm-info-badge cm-badge-fk">FK</span>');
  if (!column.nullable)
    badges.push(
      '<span class="cm-info-badge cm-badge-required">NOT NULL</span>',
    );
  if (column.is_identity)
    badges.push(
      '<span class="cm-info-badge cm-badge-identity">IDENTITY</span>',
    );

  const parts: string[] = [
    `<div class="cm-hover-title">Column Information</div>`,
    `<div class="cm-hover-header">`,
    `<code class="cm-hover-identifier">${tableName}.${column.name}</code>`,
    `</div>`,
    `<div class="cm-hover-type-row">`,
    `<span class="cm-detail-label">Type:</span> `,
    `<code class="cm-hover-type">${column.db_type}</code>`,
    `</div>`,
  ];

  if (badges.length > 0) {
    parts.push(`<div class="cm-hover-badges">${badges.join(" ")}</div>`);
  }

  if (column.default !== null && column.default !== undefined) {
    parts.push(
      `<div class="cm-hover-detail">`,
      `<span class="cm-detail-label">Default:</span> `,
      `<code>${escapeHtml(String(column.default))}</code>`,
      `</div>`,
    );
  }

  if (column.enum_values && column.enum_values.length > 0) {
    const values = column.enum_values.slice(0, 5);
    const more = column.enum_values.length > 5 ? ` (+${column.enum_values.length - 5} more)` : "";
    parts.push(
      `<div class="cm-hover-detail">`,
      `<span class="cm-detail-label">Enum values:</span> `,
      `<code>${values.map(v => escapeHtml(v)).join(", ")}${more}</code>`,
      `</div>`,
    );
  }

  if (column.comment) {
    parts.push(
      `<div class="cm-hover-comment">`,
      `<span class="cm-detail-label">Comment:</span> `,
      escapeHtml(column.comment),
      `</div>`,
    );
  }

  return parts.join("");
}

/**
 * Format table information as HTML
 */
function formatTableInfo(table: TableInfo, columnCount: number): string {
  const typeBadge =
    table.type === "view"
      ? '<span class="cm-info-badge cm-badge-view">VIEW</span>'
      : table.type === "materialized_view"
      ? '<span class="cm-info-badge cm-badge-mv">MATERIALIZED VIEW</span>'
      : '<span class="cm-info-badge cm-badge-table">TABLE</span>';

  const typeLabel = table.type === "view" ? "View" : table.type === "materialized_view" ? "Materialized View" : "Table";

  const parts: string[] = [
    `<div class="cm-hover-title">${typeLabel} Information</div>`,
    `<div class="cm-hover-header">`,
    `<code class="cm-hover-identifier">${table.schema ? `${table.schema}.` : ""}${table.name}</code>`,
    `</div>`,
    `<div class="cm-hover-badges">${typeBadge}</div>`,
    `<div class="cm-hover-detail">`,
    `<span class="cm-detail-label">Columns:</span> `,
    `<strong>${columnCount}</strong>`,
    `</div>`,
  ];

  if (table.rowCount !== undefined && table.rowCount !== null) {
    parts.push(
      `<div class="cm-hover-detail">`,
      `<span class="cm-detail-label">Rows:</span> `,
      `<strong>${table.rowCount.toLocaleString()}</strong>`,
      `</div>`,
    );
  }

  return parts.join("");
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
