/**
 * Parameter Hints Extension
 *
 * Shows function signature hints while typing function arguments.
 * Similar to VS Code's parameter hints.
 */

import {
  EditorView,
  type Tooltip,
  showTooltip,
  keymap,
  type TooltipView,
} from "@codemirror/view";
import { StateField, StateEffect, type Extension } from "@codemirror/state";
import { searchFunctions, type SqlFunction } from "../languages/sql/functions";

interface ParameterHint {
  func: SqlFunction;
  activeParam: number;
  pos: number;
}

// State effects
const showHint = StateEffect.define<ParameterHint>();
const hideHint = StateEffect.define<void>();

// State field for active hint
const parameterHintField = StateField.define<ParameterHint | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(showHint)) {
        return effect.value;
      }
      if (effect.is(hideHint)) {
        return null;
      }
    }

    // Only recompute on explicit triggers (typing ( or ,)
    // Don't recompute on every doc change - too expensive
    if (!value) return null;

    // If document changed significantly (deletion), hide hint
    if (tr.docChanged) {
      let hasCloseParen = false;
      tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        if (inserted.toString().includes(")")) {
          hasCloseParen = true;
        }
      });
      if (hasCloseParen) return null;
    }

    return value;
  },
});

/**
 * Find function call at cursor position
 * Optimized to avoid full document toString()
 */
function findFunctionAtCursor(state: typeof EditorView.prototype.state): ParameterHint | null {
  const pos = state.selection.main.head;
  const doc = state.doc;

  // Limit search to reasonable range (256 chars back)
  const searchStart = Math.max(0, pos - 256);
  const textSlice = doc.sliceString(searchStart, pos);

  // Look backwards for opening parenthesis
  let depth = 0;
  let funcEnd = -1;
  let paramIndex = 0;

  for (let i = textSlice.length - 1; i >= 0; i--) {
    const char = textSlice[i];

    if (char === ")") {
      depth++;
    } else if (char === "(") {
      if (depth === 0) {
        funcEnd = searchStart + i;
        break;
      }
      depth--;
    } else if (char === "," && depth === 0) {
      paramIndex++;
    }
  }

  if (funcEnd === -1) return null;

  // Extract function name (look for identifier before parenthesis)
  const beforeParen = doc.sliceString(Math.max(0, funcEnd - 64), funcEnd).trimEnd();
  const funcMatch = beforeParen.match(/(\w+)\s*$/);
  if (!funcMatch || !funcMatch[1]) return null;

  const funcName = funcMatch[1].toUpperCase();

  // Look up function
  const functions = searchFunctions(funcName);
  const func = functions.find(
    (f) => f.name.toUpperCase() === funcName
  );

  if (!func) return null;

  return {
    func,
    activeParam: paramIndex,
    pos: funcEnd,
  };
}

/**
 * Create tooltip content for parameter hint
 */
function createHintTooltip(hint: ParameterHint): TooltipView {
  const dom = document.createElement("div");
  dom.className = "cm-parameter-hint";

  // Function signature with highlighted active parameter
  const signature = document.createElement("div");
  signature.className = "cm-parameter-hint-signature";

  const funcName = document.createElement("span");
  funcName.className = "cm-parameter-hint-name";
  funcName.textContent = hint.func.name;
  signature.appendChild(funcName);

  signature.appendChild(document.createTextNode("("));

  hint.func.parameters.forEach((param, i) => {
    if (i > 0) {
      signature.appendChild(document.createTextNode(", "));
    }

    const paramSpan = document.createElement("span");
    paramSpan.className =
      i === hint.activeParam
        ? "cm-parameter-hint-param cm-parameter-hint-active"
        : "cm-parameter-hint-param";

    // Format: name: type or name?: type
    const paramText = param.optional
      ? `${param.name}?: ${param.type}`
      : `${param.name}: ${param.type}`;
    paramSpan.textContent = paramText;

    signature.appendChild(paramSpan);
  });

  signature.appendChild(document.createTextNode(")"));

  // Return type
  const returnType = document.createElement("span");
  returnType.className = "cm-parameter-hint-return";
  returnType.textContent = ` → ${hint.func.returnType}`;
  signature.appendChild(returnType);

  dom.appendChild(signature);

  // Active parameter info
  const activeParamInfo = hint.func.parameters[hint.activeParam];
  if (activeParamInfo) {
    const desc = document.createElement("div");
    desc.className = "cm-parameter-hint-desc";
    desc.textContent = `${activeParamInfo.name}: ${activeParamInfo.type}${activeParamInfo.optional ? " (optional)" : ""}`;
    dom.appendChild(desc);
  }

  // Function description
  if (hint.func.description) {
    const funcDesc = document.createElement("div");
    funcDesc.className = "cm-parameter-hint-func-desc";
    funcDesc.textContent = hint.func.description;
    dom.appendChild(funcDesc);
  }

  return { dom };
}

/**
 * Tooltip extension for parameter hints
 */
const parameterHintTooltip = StateField.define<readonly Tooltip[]>({
  create: () => [],
  update(_tooltips, tr) {
    const hint = tr.state.field(parameterHintField);
    if (!hint) return [];

    return [
      {
        pos: hint.pos,
        above: true,
        strictSide: true,
        arrow: true,
        create: () => createHintTooltip(hint),
      },
    ];
  },
  provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
});

/**
 * Trigger parameter hints
 */
function triggerParameterHints(view: EditorView): boolean {
  const hint = findFunctionAtCursor(view.state);
  if (hint) {
    view.dispatch({ effects: showHint.of(hint) });
    return true;
  }
  return false;
}

/**
 * Navigate to next parameter
 */
function nextParameter(view: EditorView): boolean {
  const hint = view.state.field(parameterHintField);
  if (!hint) return false;

  const nextParam = hint.activeParam + 1;
  if (nextParam >= hint.func.parameters.length) return false;

  view.dispatch({
    effects: showHint.of({ ...hint, activeParam: nextParam }),
  });
  return true;
}

/**
 * Navigate to previous parameter
 */
function prevParameter(view: EditorView): boolean {
  const hint = view.state.field(parameterHintField);
  if (!hint) return false;

  if (hint.activeParam === 0) return false;

  view.dispatch({
    effects: showHint.of({ ...hint, activeParam: hint.activeParam - 1 }),
  });
  return true;
}

/**
 * Create parameter hints extension
 */
export function createParameterHintsExtension(): Extension[] {
  return [
    parameterHintField,
    parameterHintTooltip,
    // Auto-trigger on typing ( or ,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;

      update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        const text = inserted.toString();
        if (text === "(" || text === ",") {
          // Slight delay to let the document update
          requestAnimationFrame(() => {
            triggerParameterHints(update.view);
          });
        } else if (text === ")") {
          update.view.dispatch({ effects: hideHint.of() });
        }
      });
    }),
    // Keybindings
    keymap.of([
      // Ctrl+Shift+Space to manually trigger
      {
        key: "Ctrl-Shift-Space",
        mac: "Cmd-Shift-Space",
        run: triggerParameterHints,
      },
      // Arrow keys to navigate params (when hint shown)
      {
        key: "Alt-ArrowDown",
        run: nextParameter,
      },
      {
        key: "Alt-ArrowUp",
        run: prevParameter,
      },
      // Escape to hide
      {
        key: "Escape",
        run: (view) => {
          const hint = view.state.field(parameterHintField);
          if (hint) {
            view.dispatch({ effects: hideHint.of() });
            return true;
          }
          return false;
        },
      },
    ]),
    // Styling
    EditorView.baseTheme({
      ".cm-parameter-hint": {
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "12px",
        padding: "8px 12px",
        backgroundColor: "var(--cm-tooltip-bg, #1e1e1e)",
        border: "1px solid var(--cm-tooltip-border, #3c3c3c)",
        borderRadius: "6px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
        maxWidth: "500px",
      },
      ".cm-parameter-hint-signature": {
        marginBottom: "4px",
        color: "#e5e5e5",
      },
      ".cm-parameter-hint-name": {
        color: "#dcdcaa",
        fontWeight: "600",
      },
      ".cm-parameter-hint-param": {
        color: "#9cdcfe",
      },
      ".cm-parameter-hint-active": {
        backgroundColor: "rgba(212, 165, 43, 0.2)",
        borderRadius: "2px",
        padding: "0 2px",
        fontWeight: "600",
      },
      ".cm-parameter-hint-return": {
        color: "#4ec9b0",
      },
      ".cm-parameter-hint-desc": {
        color: "#9ca3af",
        fontSize: "11px",
        marginTop: "4px",
        borderTop: "1px solid #3c3c3c",
        paddingTop: "4px",
      },
      ".cm-parameter-hint-func-desc": {
        color: "#6b7280",
        fontSize: "11px",
        marginTop: "4px",
        fontStyle: "italic",
      },
    }),
  ];
}
