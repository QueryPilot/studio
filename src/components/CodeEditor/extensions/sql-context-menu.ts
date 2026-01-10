/**
 * SQL Context Menu Extension
 *
 * Provides right-click context menu for SQL identifiers.
 * Emits custom events that SqlEditor handles to show React-based context menu.
 */

import { EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  buildSymbolTable,
  resolveSymbol,
} from "../languages/sql/symbol-table";
import type { SqlContextTarget } from "../components/SqlContextMenu";

/**
 * Custom event for context menu requests
 */
export interface SqlContextMenuEvent {
  target: SqlContextTarget;
  position: { x: number; y: number };
}

/**
 * Find the identifier at a given position and resolve it to a context target
 */
function findContextTarget(
  view: EditorView,
  pos: number
): SqlContextTarget | null {
  try {
    const { state } = view;
    const tree = syntaxTree(state);
    const node = tree.resolveInner(pos, -1);

    // Check if we're on an identifier
    if (node.name !== "Identifier" && node.name !== "QuotedIdentifier") {
      return null;
    }

    const name = state.doc
      .sliceString(node.from, node.to)
      .replace(/["`[\]]/g, "");

    // Build symbol table to resolve aliases/CTEs
    const symbolTable = buildSymbolTable(state);
    const symbol = resolveSymbol(symbolTable, name, pos);

    // If it's an alias, return alias target
    if (symbol && symbol.type === "alias") {
      return {
        type: "alias",
        name: symbol.name,
        sourceTable: symbol.sourceTable,
        sourceSchema: symbol.sourceSchema,
        definitionPos: { from: symbol.from, to: symbol.to },
      };
    }

    // If it's a CTE, return CTE target
    if (symbol && symbol.type === "cte") {
      return {
        type: "cte",
        name: symbol.name,
        sourceTable: symbol.sourceTable,
        definitionPos: { from: symbol.from, to: symbol.to },
      };
    }

    // Check for table context
    const prevSibling = node.prevSibling;
    const tableKeywords = ["from", "join", "into", "update", "table", "delete"];
    const isTableContext =
      prevSibling?.name === "Keyword" &&
      tableKeywords.includes(
        state.doc.sliceString(prevSibling.from, prevSibling.to).toLowerCase()
      );

    if (isTableContext) {
      // Check for schema.table pattern
      let schema: string | undefined;
      if (prevSibling?.prevSibling?.name === ".") {
        const schemaNode = prevSibling.prevSibling.prevSibling;
        if (schemaNode) {
          schema = state.doc
            .sliceString(schemaNode.from, schemaNode.to)
            .replace(/["`[\]]/g, "");
        }
      }

      return {
        type: "table",
        name,
        sourceSchema: schema,
      };
    }

    // Check for qualified column (table.column or alias.column)
    if (prevSibling?.name === ".") {
      const qualifierNode = prevSibling.prevSibling;
      if (qualifierNode) {
        const qualifier = state.doc
          .sliceString(qualifierNode.from, qualifierNode.to)
          .replace(/["`[\]]/g, "");

        // Resolve qualifier to table name
        const qualifierSymbol = resolveSymbol(symbolTable, qualifier, pos);
        let tableName = qualifier;

        if (qualifierSymbol) {
          if (
            qualifierSymbol.type === "alias" ||
            qualifierSymbol.type === "cte"
          ) {
            tableName = qualifierSymbol.sourceTable || qualifierSymbol.name;
          } else if (qualifierSymbol.type === "table") {
            tableName = qualifierSymbol.name;
          }
        }

        return {
          type: "column",
          name,
          tableName,
        };
      }
    }

    // Check if in SELECT/WHERE clause - likely a column
    const clauseTypes = [
      "SelectClause",
      "WhereClause",
      "GroupByClause",
      "OrderByClause",
      "HavingClause",
    ];

    let current = node.parent;
    while (current) {
      if (clauseTypes.includes(current.name)) {
        return {
          type: "column",
          name,
        };
      }
      current = current.parent;
    }

    // Default to table if we couldn't determine
    return {
      type: "table",
      name,
    };
  } catch (error) {
    console.error("[findContextTarget] Error:", error);
    return null;
  }
}

/**
 * Create SQL context menu extension
 */
export function createSqlContextMenuExtension(): Extension {
  return EditorView.domEventHandlers({
    contextmenu: (event, view) => {
      try {
        // Get position under cursor
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;

        // Find what identifier is under cursor
        const target = findContextTarget(view, pos);
        if (!target) return false;

        // Prevent default browser context menu
        event.preventDefault();
        event.stopPropagation();

        // Dispatch custom event for SqlEditor to handle
        const customEvent = new CustomEvent<SqlContextMenuEvent>(
          "sql-context-menu",
          {
            detail: {
              target,
              position: { x: event.clientX, y: event.clientY },
            },
            bubbles: true,
          }
        );
        view.dom.dispatchEvent(customEvent);

        return true;
      } catch (error) {
        // Silently fail - allow default browser context menu
        console.error("[sql-context-menu] Error:", error);
        return false;
      }
    },
  });
}
