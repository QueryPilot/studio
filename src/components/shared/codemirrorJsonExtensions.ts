import { json as jsonLang } from "@codemirror/lang-json";
import { bracketMatching } from "@codemirror/language";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { keymap, EditorView } from "@codemirror/view";

export const JSON_EXTENSIONS = [
  jsonLang(),
  bracketMatching(),
  history(),
  keymap.of([...historyKeymap, ...defaultKeymap]),
  EditorView.theme({
    ".cm-scroller": {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: "12px",
    },
  }),
];
