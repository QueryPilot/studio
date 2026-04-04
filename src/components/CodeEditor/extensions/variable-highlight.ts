import { Facet, Prec, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { parseVariables } from "@/lib/queryVariables/parser";
import type { ParsedVariable, QueryVariable } from "@/lib/queryVariables/types";
import { variableKey } from "@/lib/queryVariables/types";

interface VariableFacetValue {
  variables: Record<string, QueryVariable>;
  scope: "global" | "per_statement";
}

const EMPTY_FACET: VariableFacetValue = { variables: {}, scope: "global" };

/** Facet to pass variable values + scope from React into the CM extension */
export const variableValuesFacet = Facet.define<VariableFacetValue, VariableFacetValue>({
  combine: (inputs) => inputs.at(0) ?? EMPTY_FACET,
});

/** Custom event dispatched when a variable widget is clicked */
export interface VariableClickDetail {
  key: string;
  name: string;
  rect: DOMRect;
}

const varDecoration = Decoration.mark({
  class: "cm-query-variable",
});

class VariableValueWidget extends WidgetType {
  constructor(
    readonly variable: ParsedVariable,
    readonly varValue: string,
    readonly varKey: string,
  ) {
    super();
  }

  eq(other: VariableValueWidget): boolean {
    return this.varKey === other.varKey
      && this.varValue === other.varValue
      && this.variable.offset === other.variable.offset;
  }

  toDOM(): HTMLElement {
    const pill = document.createElement("span");
    const hasValue = this.varValue.length > 0;
    pill.className = hasValue ? "cm-variable-pill cm-variable-pill--filled" : "cm-variable-pill cm-variable-pill--empty";
    pill.setAttribute("data-variable-key", this.varKey);
    pill.setAttribute("data-variable-name", this.variable.name);

    const display = hasValue
      ? (this.varValue.length > 20 ? this.varValue.slice(0, 20) + "\u2026" : this.varValue)
      : "empty";

    pill.textContent = display;
    pill.title = hasValue
      ? `${this.variable.name} = ${this.varValue}`
      : `Click to set ${this.variable.name}`;
    return pill;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc.toString();

  if (!doc.trim()) return builder.finish();

  const { variables: vars, scope } = view.state.facet(variableValuesFacet);
  const { variables } = parseVariables(doc, { scope });
  const sorted = [...variables].sort((a, b) => a.offset - b.offset);

  const seen = new Set<string>();

  for (const v of sorted) {
    const from = v.offset;
    const to = v.offset + v.length;
    if (to > doc.length) continue;

    builder.add(from, to, varDecoration);

    const key = variableKey(v.name, v.syntax, scope, v.statementIndex);
    const pillKey = `${key}-${v.offset}`;
    if (!seen.has(pillKey)) {
      seen.add(pillKey);
      const value = vars[key]?.value ?? "";
      builder.add(
        to,
        to,
        Decoration.widget({
          widget: new VariableValueWidget(v, value, key),
          side: 1,
        }),
      );
    }
  }

  return builder.finish();
}

const variableHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.startState.facet(variableValuesFacet) !== update.state.facet(variableValuesFacet)) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(event, view) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return false;
        const pill = target.closest(".cm-variable-pill");
        if (!pill) return false;

        const key = pill.getAttribute("data-variable-key");
        const name = pill.getAttribute("data-variable-name");
        if (!key || !name) return false;

        const rect = pill.getBoundingClientRect();
        const detail: VariableClickDetail = { key, name, rect };
        view.dom.dispatchEvent(new CustomEvent("variable-click", { detail, bubbles: true }));
        event.preventDefault();
        return true;
      },
    },
  },
);

const variableHighlightTheme = EditorView.baseTheme({
  ".cm-query-variable": {
    backgroundColor: "color-mix(in srgb, var(--color-primary) 15%, transparent)",
    borderRadius: "2px",
    padding: "0 1px",
    borderBottom: "1.5px dotted var(--color-primary)",
  },
  ".cm-variable-pill": {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    lineHeight: "1.2",
    padding: "1px 5px",
    marginLeft: "3px",
    borderRadius: "4px",
    verticalAlign: "middle",
    cursor: "pointer",
  },
  ".cm-variable-pill--filled": {
    backgroundColor: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
    color: "var(--color-primary)",
    border: "0.5px solid color-mix(in srgb, var(--color-primary) 30%, transparent)",
  },
  ".cm-variable-pill--empty": {
    backgroundColor: "color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent)",
    color: "var(--color-warning, #b45309)",
    border: "0.5px solid color-mix(in srgb, var(--color-warning, #f59e0b) 40%, transparent)",
    fontStyle: "italic",
  },
  ".cm-variable-pill:hover": {
    filter: "brightness(0.92)",
  },
});

const variableEditKeymap = Prec.highest(keymap.of([
  {
    key: "Mod-.",
    run(view) {
      const doc = view.state.doc.toString();
      if (!doc.trim()) return false;

      const { scope } = view.state.facet(variableValuesFacet);
      const { variables } = parseVariables(doc, { scope });
      if (variables.length === 0) return false;

      const cursor = view.state.selection.main.head;

      // Only activate when cursor is inside or adjacent to a variable (within 2 chars of its range)
      const MAX_DIST = 2;
      let best: ParsedVariable | undefined;
      let bestDist = Infinity;
      for (const v of variables) {
        const from = v.offset;
        const to = v.offset + v.length;
        if (cursor >= from && cursor <= to) {
          best = v;
          bestDist = 0;
          break;
        }
        const dist = cursor < from ? from - cursor : cursor - to;
        if (dist < bestDist) {
          bestDist = dist;
          best = v;
        }
      }

      if (!best || bestDist > MAX_DIST) return false;

      const key = variableKey(best.name, best.syntax, scope, best.statementIndex);
      const pill = view.dom.querySelector<HTMLElement>(
        `.cm-variable-pill[data-variable-key="${CSS.escape(key)}"]`,
      );
      const coords = view.coordsAtPos(best.offset + best.length);
      const rect = pill?.getBoundingClientRect() ?? (coords ? new DOMRect(coords.left, coords.top, 60, 20) : null);
      if (!rect) return false;

      const detail: VariableClickDetail = { key, name: best.name, rect };
      view.dom.dispatchEvent(new CustomEvent("variable-click", { detail, bubbles: true }));
      return true;
    },
  },
]));

export function createVariableHighlightExtension() {
  return [variableHighlightPlugin, variableHighlightTheme, variableEditKeymap];
}
