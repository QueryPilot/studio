/**
 * Go-to-Definition Extension
 *
 * Cmd+Click or F12 on table/column name to navigate to schema.
 * Emits custom events for the parent to handle navigation.
 */

import { EditorView, keymap, Decoration, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { MetadataProvider } from "../types";

interface DefinitionTarget {
  type: "table" | "column";
  name: string;
  schema?: string;
  table?: string; // For columns
  from: number;
  to: number;
}

// Custom events
export interface GotoDefinitionEvent {
  type: "table" | "column";
  name: string;
  schema?: string;
  table?: string;
}

// State effect for highlighting
const setHighlight = StateEffect.define<{ from: number; to: number } | null>();

// Highlight decoration
const highlightMark = Decoration.mark({ class: "cm-goto-highlight" });

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlight)) {
        if (effect.value) {
          return Decoration.set([
            highlightMark.range(effect.value.from, effect.value.to),
          ]);
        }
        return Decoration.none;
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Find definition target at position
 */
function findTargetAtPosition(
  view: EditorView,
  pos: number
): DefinitionTarget | null {
  const { state } = view;
  const tree = syntaxTree(state);
  const node = tree.resolveInner(pos, 0);

  // Check if we're on an identifier
  if (node.name !== "Identifier" && node.name !== "QuotedIdentifier") {
    return null;
  }

  const name = state.doc.sliceString(node.from, node.to).replace(/["`[\]]/g, "");
  const parent = node.parent;
  const prevSibling = node.prevSibling;

  // Check for table context (FROM, JOIN, INTO, UPDATE, etc.)
  const tableKeywords = ["from", "join", "into", "update", "table", "delete"];
  const isTableContext =
    prevSibling?.name === "Keyword" &&
    tableKeywords.includes(
      state.doc.sliceString(prevSibling.from, prevSibling.to).toLowerCase()
    );

  // Check for schema.table or table.column pattern
  if (prevSibling?.name === ".") {
    const schemaOrTable = prevSibling.prevSibling;
    if (schemaOrTable) {
      const qualifier = state.doc
        .sliceString(schemaOrTable.from, schemaOrTable.to)
        .replace(/["`[\]]/g, "");

      // If in table context, it's schema.table
      if (isTableContext) {
        return {
          type: "table",
          name,
          schema: qualifier,
          from: node.from,
          to: node.to,
        };
      }

      // Otherwise it's table.column
      return {
        type: "column",
        name,
        table: qualifier,
        from: node.from,
        to: node.to,
      };
    }
  }

  // Check for schema after identifier (identifier.something)
  const nextSibling = node.nextSibling;
  if (nextSibling?.name === ".") {
    // This is a qualifier (schema or table), not a target
    return null;
  }

  // Standalone identifier
  if (isTableContext) {
    return {
      type: "table",
      name,
      from: node.from,
      to: node.to,
    };
  }

  // Check if in SELECT, WHERE, etc. - likely a column
  const clauseTypes = [
    "SelectClause",
    "WhereClause",
    "GroupByClause",
    "OrderByClause",
    "HavingClause",
    "SetClause",
  ];

  let current = parent;
  while (current) {
    if (clauseTypes.includes(current.name)) {
      return {
        type: "column",
        name,
        from: node.from,
        to: node.to,
      };
    }
    current = current.parent;
  }

  return null;
}

/**
 * Navigate to definition
 */
async function gotoDefinition(
  view: EditorView,
  pos: number,
  _provider?: MetadataProvider
): Promise<boolean> {
  const target = findTargetAtPosition(view, pos);
  if (!target) return false;

  // Dispatch custom event for parent to handle
  const event = new CustomEvent<GotoDefinitionEvent>("goto-definition", {
    detail: {
      type: target.type,
      name: target.name,
      schema: target.schema,
      table: target.table,
    },
    bubbles: true,
  });
  view.dom.dispatchEvent(event);

  // Highlight the target briefly
  view.dispatch({ effects: setHighlight.of({ from: target.from, to: target.to }) });
  setTimeout(() => {
    view.dispatch({ effects: setHighlight.of(null) });
  }, 300);

  return true;
}

/**
 * Create goto-definition extension
 */
export function createGotoDefinitionExtension(
  provider?: MetadataProvider
): Extension[] {
  return [
    highlightField,
    // Cmd+Click handler
    EditorView.domEventHandlers({
      click: (event, view) => {
        if (event.metaKey || event.ctrlKey) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos !== null) {
            event.preventDefault();
            gotoDefinition(view, pos, provider);
            return true;
          }
        }
        return false;
      },
      // Show pointer cursor on Cmd+hover
      mousemove: (event, view) => {
        if (event.metaKey || event.ctrlKey) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos !== null) {
            const target = findTargetAtPosition(view, pos);
            view.dom.style.cursor = target ? "pointer" : "";
          }
        } else {
          view.dom.style.cursor = "";
        }
        return false;
      },
      keyup: (event, view) => {
        if (event.key === "Meta" || event.key === "Control") {
          view.dom.style.cursor = "";
        }
        return false;
      },
    }),
    // F12 keybinding
    keymap.of([
      {
        key: "F12",
        run: (view) => {
          const pos = view.state.selection.main.head;
          gotoDefinition(view, pos, provider);
          return true;
        },
      },
      // Cmd+. as alternative
      {
        key: "Mod-.",
        run: (view) => {
          const pos = view.state.selection.main.head;
          gotoDefinition(view, pos, provider);
          return true;
        },
      },
    ]),
    // Styling
    EditorView.baseTheme({
      ".cm-goto-highlight": {
        backgroundColor: "rgba(252, 163, 17, 0.3)",
        borderRadius: "2px",
      },
    }),
  ];
}
