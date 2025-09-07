import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { githubLight } from "@uiw/codemirror-theme-github";

// Fold gutter theme - only keep fold icon customization
export const foldGutterTheme = EditorView.theme({
  ".cm-foldGutter": {
    width: "20px",
  },
  ".cm-foldGutter .cm-gutterElement": {
    padding: "0",
    cursor: "pointer",
    color: "#888",
    transition: "color 0.2s",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  ".cm-foldGutter .cm-gutterElement:hover": {
    color: "#FCA311",
  },
  ".cm-foldGutter .cm-gutterElement > span": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
});

export const getThemeExtensions = (theme: "light" | "dark"): Extension[] => {
  if (theme === "dark") {
    return [vscodeDark, foldGutterTheme];
  }
  return [githubLight, foldGutterTheme];
};