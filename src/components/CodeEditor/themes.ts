import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { githubDarkInit, githubLightInit } from "@uiw/codemirror-theme-github";
import { tags as t } from "@lezer/highlight";

// Fold gutter theme with adaptive colors
export const createFoldGutterTheme = (isDark: boolean) =>
  EditorView.theme({
    ".cm-foldGutter": {
      width: "20px",
    },
    ".cm-foldGutter .cm-gutterElement": {
      padding: "0",
      cursor: "pointer",
      color: isDark ? "#6B7280" : "#9CA3AF",
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

// Custom dark theme with brand colors and proper visibility
export const createDarkTheme = (): Extension => {
  return githubDarkInit({
    settings: {
      background: "#09090B",
      backgroundImage: "",
      foreground: "#E5E5E5",
      caret: "#FCA311",
      selection: "#FCA31140",
      selectionMatch: "#FCA31128",
      lineHighlight: "#FFFFFF08",
      gutterBackground: "#09090B",
      gutterForeground: "#6B7280",
      gutterBorder: "transparent",
    },
    styles: [
      // Keywords - brand amber
      { tag: [t.keyword, t.operator, t.operatorKeyword], color: "#FCA311" },
      {
        tag: [t.controlKeyword, t.definitionKeyword],
        color: "#FCA311",
        fontWeight: "600",
      },

      // Functions - orange
      {
        tag: [t.function(t.variableName), t.function(t.propertyName)],
        color: "#FF9800",
      },

      // Strings - green
      { tag: [t.string, t.special(t.string)], color: "#22C55E" },

      // Numbers - cyan
      { tag: [t.number, t.integer, t.float], color: "#06B6D4" },

      // Comments - muted
      {
        tag: [t.lineComment, t.blockComment, t.docComment],
        color: "#6B7280",
        fontStyle: "italic",
      },

      // Types and definitions - light blue
      { tag: [t.typeName, t.className, t.namespace], color: "#60A5FA" },

      // Properties and variables
      { tag: [t.propertyName], color: "#A78BFA" },
      { tag: [t.variableName], color: "#E5E5E5" },

      // Special SQL elements
      { tag: [t.bool, t.null, t.atom], color: "#F472B6" },

      // Brackets and punctuation
      { tag: [t.bracket, t.paren], color: "#9CA3AF" },
      { tag: [t.punctuation, t.separator], color: "#6B7280" },
    ],
  });
};

// Custom light theme with brand colors and proper contrast
export const createLightTheme = (): Extension => {
  return githubLightInit({
    settings: {
      background: "#FFFFFF",
      backgroundImage: "",
      foreground: "#0A0A0B",
      caret: "#FCA311",
      selection: "#FCA31135",
      selectionMatch: "#FCA31120",
      lineHighlight: "#00000008",
      gutterBackground: "#FFFFFF",
      gutterForeground: "#6B7280",
      gutterBorder: "transparent",
    },
    styles: [
      // Keywords - brand amber (slightly darker for contrast)
      { tag: [t.keyword, t.operator, t.operatorKeyword], color: "#EA9A0F" },
      {
        tag: [t.controlKeyword, t.definitionKeyword],
        color: "#EA9A0F",
        fontWeight: "600",
      },

      // Functions - orange
      {
        tag: [t.function(t.variableName), t.function(t.propertyName)],
        color: "#F97316",
      },

      // Strings - green
      { tag: [t.string, t.special(t.string)], color: "#16A34A" },

      // Numbers - cyan
      { tag: [t.number, t.integer, t.float], color: "#0891B2" },

      // Comments - muted
      {
        tag: [t.lineComment, t.blockComment, t.docComment],
        color: "#6B7280",
        fontStyle: "italic",
      },

      // Types and definitions - blue
      { tag: [t.typeName, t.className, t.namespace], color: "#2563EB" },

      // Properties and variables
      { tag: [t.propertyName], color: "#7C3AED" },
      { tag: [t.variableName], color: "#0A0A0B" },

      // Special SQL elements
      { tag: [t.bool, t.null, t.atom], color: "#DB2777" },

      // Brackets and punctuation
      { tag: [t.bracket, t.paren], color: "#4B5563" },
      { tag: [t.punctuation, t.separator], color: "#6B7280" },
    ],
  });
};

// Get theme extensions based on theme mode
export const getThemeExtensions = (theme: "light" | "dark"): Extension[] => {
  const isDark = theme === "dark";

  return [
    isDark ? createDarkTheme() : createLightTheme(),
    createFoldGutterTheme(isDark),
  ];
};
