/**
 * Function Parameter Hints
 * Shows signature help when typing inside function calls
 */

import { StateField, StateEffect } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet, WidgetType } from "@codemirror/view";
import { SQL_FUNCTIONS } from "@/data/sqlFunctions";
import type { SqlFunction } from "@/types/sqlFunctions";

// Effect to update active function signature
const setSignature = StateEffect.define<{
  from: number;
  to: number;
  function: SqlFunction;
  activeParam: number;
} | null>();

// Decoration for parameter hints tooltip
const signatureTooltip = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(tooltips, tr) {
    tooltips = tooltips.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(setSignature)) {
        if (effect.value === null) {
          tooltips = Decoration.none;
        } else {
          const { from, function: func, activeParam } = effect.value;

          // Build signature display
          const params = func.parameters
            .map((p, i) => {
              const text = p.optional
                ? `[${p.name}: ${p.type}]`
                : `${p.name}: ${p.type}`;
              return i === activeParam ? `**${text}**` : text;
            })
            .join(", ");

          const signature = `${func.name}(${params}) → ${func.returnType}`;

          const widget = Decoration.widget({
            widget: new SignatureWidget(signature, func.description),
            side: 1,
          });

          tooltips = Decoration.set([widget.range(from)]);
        }
      }
    }

    return tooltips;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Widget to display signature
class SignatureWidget extends WidgetType {
  constructor(private signature: string, private description: string) {
    super();
  }

  toDOM() {
    const dom = document.createElement("div");
    dom.className = "cm-signature-tooltip";

    const sig = document.createElement("div");
    sig.className = "cm-signature";
    sig.textContent = this.signature;

    const desc = document.createElement("div");
    desc.className = "cm-signature-desc";
    desc.textContent = this.description;

    dom.appendChild(sig);
    dom.appendChild(desc);

    return dom;
  }

  eq(other: SignatureWidget) {
    return other.signature === this.signature && other.description === this.description;
  }

  updateDOM(_dom: HTMLElement): boolean {
    return false;
  }

  get estimatedHeight() {
    return -1;
  }

  ignoreEvent() {
    return true;
  }
}

/**
 * Detect function call context and show parameter hints
 */
export function parameterHints() {
  return [
    signatureTooltip,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged && !update.selectionSet) return;

      const { state } = update;
      const pos = state.selection.main.head;
      const textBefore = state.doc.sliceString(Math.max(0, pos - 100), pos);

      // Find if we're inside a function call
      const functionMatch = textBefore.match(/\b([A-Z_]+)\s*\(\s*([^)]*)?$/i);

      if (functionMatch && functionMatch[1]) {
        const funcName = functionMatch[1].toUpperCase();
        const argsText = functionMatch[2] || "";

        // Find the function in our catalog
        const func = SQL_FUNCTIONS.find((f) => f.name === funcName);

        if (func) {
          // Count commas to determine active parameter
          const commaCount = (argsText.match(/,/g) || []).length;
          const activeParam = Math.min(commaCount, func.parameters.length - 1);

          const functionStart = pos - functionMatch[0].length;

          update.view.dispatch({
            effects: setSignature.of({
              from: functionStart,
              to: pos,
              function: func,
              activeParam,
            }),
          });

          return;
        }
      }

      // Clear signature if not in function context
      update.view.dispatch({
        effects: setSignature.of(null),
      });
    }),
  ];
}

/**
 * Get the function signature for display
 */
export function getFunctionSignature(
  func: SqlFunction,
  activeParam?: number,
): string {
  const params = func.parameters
    .map((p, i) => {
      const text = p.optional
        ? `[${p.name}: ${p.type}]`
        : `${p.name}: ${p.type}`;
      return i === activeParam ? `**${text}**` : text;
    })
    .join(", ");

  return `${func.name}(${params}) → ${func.returnType}`;
}
