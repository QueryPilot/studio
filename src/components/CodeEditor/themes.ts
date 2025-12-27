import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { githubDarkInit, githubLightInit } from "@uiw/codemirror-theme-github";
import { tags as t } from "@lezer/highlight";

/**
 * CodeEditor theme using oklch-based color palette from globals.css
 *
 * Color mappings:
 * - Primary: oklch(0.79 0.145 77) ≈ #D4A52B (warm golden)
 * - Dark bg: oklch(0.17 0.008 80) ≈ #27231E
 * - Dark foreground: oklch(0.93 0.008 80) ≈ #EDE9E3
 * - Dark muted: oklch(0.45 0.01 80) ≈ #7A756C
 * - Light foreground: oklch(0.17 0.008 80) ≈ #27231E
 */

// Fold gutter theme with adaptive colors
export const createFoldGutterTheme = (isDark: boolean) =>
  EditorView.theme({
    ".cm-foldGutter": {
      width: "20px",
    },
    ".cm-foldGutter .cm-gutterElement": {
      padding: "0",
      cursor: "pointer",
      color: isDark ? "#9A958C" : "#7A756C",
      transition: "color 0.2s",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
    },
    ".cm-foldGutter .cm-gutterElement:hover": {
      color: "#D4A52B",
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
      background: "#110F0C",
      backgroundImage: "",
      foreground: "#EBE7E2",
      caret: "#D4A52B",
      selection: "#D4A52B33",
      selectionMatch: "#D4A52B28",
      lineHighlight: "#FFFFFF14",
      gutterBackground: "#110F0C",
      gutterForeground: "#7A756C",
      gutterBorder: "#FFFFFF1A",
    },
    styles: [
      // Keywords - brand golden
      { tag: [t.keyword, t.operator, t.operatorKeyword], color: "#D4A52B" },
      {
        tag: [t.controlKeyword, t.definitionKeyword],
        color: "#D4A52B",
        fontWeight: "600",
      },

      // Functions - warm orange
      {
        tag: [t.function(t.variableName), t.function(t.propertyName)],
        color: "#E5923A",
      },

      // Strings - green
      { tag: [t.string, t.special(t.string)], color: "#22C55E" },

      // Numbers - cyan
      { tag: [t.number, t.integer, t.float], color: "#06B6D4" },

      // Comments - muted (oklch(0.45 0.01 80))
      {
        tag: [t.lineComment, t.blockComment, t.docComment],
        color: "#7A756C",
        fontStyle: "italic",
      },

      // Types and definitions - light blue
      { tag: [t.typeName, t.className, t.namespace], color: "#60A5FA" },

      // Properties and variables
      { tag: [t.propertyName], color: "#A78BFA" },
      { tag: [t.variableName], color: "#EBE7E2" },

      // Special SQL elements
      { tag: [t.bool, t.null, t.atom], color: "#F472B6" },

      // Brackets and punctuation
      { tag: [t.bracket, t.paren], color: "#9A958C" },
      { tag: [t.punctuation, t.separator], color: "#7A756C" },
    ],
  });
};

// Custom light theme with brand colors and proper contrast
export const createLightTheme = (): Extension => {
  return githubLightInit({
    settings: {
      background: "#FAF8F5",
      backgroundImage: "",
      foreground: "#27231E",
      caret: "#D4A52B",
      selection: "#D4A52B33",
      selectionMatch: "#D4A52B20",
      lineHighlight: "#00000014",
      gutterBackground: "#FAF8F5",
      gutterForeground: "#7A756C",
      gutterBorder: "#27231E1A",
    },
    styles: [
      // Keywords - brand golden (slightly darker for light bg contrast)
      { tag: [t.keyword, t.operator, t.operatorKeyword], color: "#B8911F" },
      {
        tag: [t.controlKeyword, t.definitionKeyword],
        color: "#B8911F",
        fontWeight: "600",
      },

      // Functions - warm orange
      {
        tag: [t.function(t.variableName), t.function(t.propertyName)],
        color: "#D17D2A",
      },

      // Strings - green
      { tag: [t.string, t.special(t.string)], color: "#16A34A" },

      // Numbers - cyan
      { tag: [t.number, t.integer, t.float], color: "#0891B2" },

      // Comments - muted (oklch(0.45 0.01 80))
      {
        tag: [t.lineComment, t.blockComment, t.docComment],
        color: "#7A756C",
        fontStyle: "italic",
      },

      // Types and definitions - blue
      { tag: [t.typeName, t.className, t.namespace], color: "#2563EB" },

      // Properties and variables
      { tag: [t.propertyName], color: "#7C3AED" },
      { tag: [t.variableName], color: "#27231E" },

      // Special SQL elements
      { tag: [t.bool, t.null, t.atom], color: "#DB2777" },

      // Brackets and punctuation
      { tag: [t.bracket, t.paren], color: "#5A554C" },
      { tag: [t.punctuation, t.separator], color: "#7A756C" },
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
