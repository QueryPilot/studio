/**
 * Custom Monaco Editor Themes
 * Matches the application's color scheme from globals.css
 */

import type { editor } from "monaco-editor";

export const lightTheme: editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    // SQL Keywords
    { token: "keyword.sql", foreground: "0652DD", fontStyle: "bold" }, // Bright blue
    { token: "keyword", foreground: "0652DD", fontStyle: "bold" },
    
    // SQL Functions
    { token: "predefined.sql", foreground: "7209B7" }, // Purple
    { token: "function.sql", foreground: "7209B7" },
    
    // Strings
    { token: "string.sql", foreground: "008000" }, // Green
    { token: "string", foreground: "008000" },
    
    // Numbers
    { token: "number.sql", foreground: "B8336A" }, // Rose
    { token: "number", foreground: "B8336A" },
    
    // Comments
    { token: "comment.sql", foreground: "6B6B6B", fontStyle: "italic" },
    { token: "comment", foreground: "6B6B6B", fontStyle: "italic" },
    
    // Operators
    { token: "operator.sql", foreground: "000000" },
    { token: "delimiter.sql", foreground: "000000" },
    
    // Identifiers (table names, column names)
    { token: "identifier.sql", foreground: "1A1A1A" },
    { token: "identifier", foreground: "1A1A1A" },
    
    // Variables
    { token: "variable", foreground: "E85D00" }, // Orange
  ],
  colors: {
    // Editor colors
    "editor.background": "#FFFFFF",
    "editor.foreground": "#0A0A0A",
    "editorLineNumber.foreground": "#9CA3AF",
    "editorLineNumber.activeForeground": "#FCA311", // Brand amber
    "editor.lineHighlightBackground": "#F9FAFB",
    "editor.lineHighlightBorder": "#00000000",
    "editor.selectionBackground": "#FCA31133", // Brand amber with opacity
    "editor.inactiveSelectionBackground": "#E5E7EB22",
    
    // Cursor
    "editorCursor.foreground": "#FCA311", // Brand amber
    "editorCursor.background": "#FFFFFF",
    
    // Whitespace & indentation
    "editorWhitespace.foreground": "#E5E7EB",
    "editorIndentGuide.background": "#E5E7EB",
    "editorIndentGuide.activeBackground": "#D1D5DB",
    
    // Brackets
    "editorBracketMatch.background": "#FCA31122",
    "editorBracketMatch.border": "#FCA311",
    
    // Scrollbar
    "scrollbar.shadow": "#00000010",
    "scrollbarSlider.background": "#00000020",
    "scrollbarSlider.hoverBackground": "#00000030",
    "scrollbarSlider.activeBackground": "#00000040",
    
    // Minimap
    "minimap.background": "#FFFFFF",
    "minimap.selectionHighlight": "#FCA31166",
    
    // Find match
    "editor.findMatchBackground": "#FCA31144",
    "editor.findMatchHighlightBackground": "#FCA31122",
    
    // Word highlight
    "editor.wordHighlightBackground": "#FCA31122",
    "editor.wordHighlightStrongBackground": "#FCA31133",
    
    // Suggest widget
    "editorSuggestWidget.background": "#FFFFFF",
    "editorSuggestWidget.border": "#E5E7EB",
    "editorSuggestWidget.foreground": "#0A0A0A",
    "editorSuggestWidget.highlightForeground": "#FCA311",
    "editorSuggestWidget.selectedBackground": "#F3F4F6",
    "editorSuggestWidget.focusHighlightForeground": "#FCA311",
    
    // Hover widget
    "editorHoverWidget.background": "#FFFFFF",
    "editorHoverWidget.border": "#E5E7EB",
    "editorHoverWidget.foreground": "#0A0A0A",
    
    // Editor widget
    "editorWidget.background": "#FFFFFF",
    "editorWidget.border": "#E5E7EB",
    
    // Gutter
    "editorGutter.background": "#FFFFFF",
    "editorGutter.addedBackground": "#10B98144",
    "editorGutter.deletedBackground": "#EF444444",
    "editorGutter.modifiedBackground": "#3B82F644",
    
    // Overview ruler
    "editorOverviewRuler.border": "#E5E7EB",
    "editorOverviewRuler.findMatchForeground": "#FCA31166",
    "editorOverviewRuler.selectionHighlightForeground": "#FCA31166",
  }
};

export const darkTheme: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    // SQL Keywords
    { token: "keyword.sql", foreground: "569CD6", fontStyle: "bold" }, // Soft blue
    { token: "keyword", foreground: "569CD6", fontStyle: "bold" },
    
    // SQL Functions
    { token: "predefined.sql", foreground: "C586C0" }, // Soft purple
    { token: "function.sql", foreground: "C586C0" },
    
    // Strings
    { token: "string.sql", foreground: "6A9955" }, // Soft green
    { token: "string", foreground: "6A9955" },
    
    // Numbers
    { token: "number.sql", foreground: "B5CEA8" }, // Light green
    { token: "number", foreground: "B5CEA8" },
    
    // Comments
    { token: "comment.sql", foreground: "6A737D", fontStyle: "italic" },
    { token: "comment", foreground: "6A737D", fontStyle: "italic" },
    
    // Operators
    { token: "operator.sql", foreground: "D4D4D4" },
    { token: "delimiter.sql", foreground: "D4D4D4" },
    
    // Identifiers (table names, column names)
    { token: "identifier.sql", foreground: "9CDCFE" }, // Light blue
    { token: "identifier", foreground: "9CDCFE" },
    
    // Variables
    { token: "variable", foreground: "FCA311" }, // Brand amber
  ],
  colors: {
    // Editor colors - matching our dark theme
    "editor.background": "#0a0a0b", // True black background
    "editor.foreground": "#fafafa", // White text
    "editorLineNumber.foreground": "#6b7280",
    "editorLineNumber.activeForeground": "#fca311", // Brand amber
    "editor.lineHighlightBackground": "#111113", // Slightly elevated
    "editor.lineHighlightBorder": "#00000000",
    "editor.selectionBackground": "#fca31133", // Brand amber with opacity
    "editor.inactiveSelectionBackground": "#27272a22",
    
    // Cursor
    "editorCursor.foreground": "#fca311", // Brand amber
    "editorCursor.background": "#0a0a0b",
    
    // Whitespace & indentation
    "editorWhitespace.foreground": "#27272a",
    "editorIndentGuide.background": "#27272a",
    "editorIndentGuide.activeBackground": "#3f3f46",
    
    // Brackets
    "editorBracketMatch.background": "#fca31122",
    "editorBracketMatch.border": "#fca311",
    
    // Scrollbar
    "scrollbar.shadow": "#00000080",
    "scrollbarSlider.background": "#ffffff20",
    "scrollbarSlider.hoverBackground": "#ffffff30",
    "scrollbarSlider.activeBackground": "#ffffff40",
    
    // Minimap
    "minimap.background": "#0A0A0B",
    "minimap.selectionHighlight": "#FCA31166",
    
    // Find match
    "editor.findMatchBackground": "#FCA31144",
    "editor.findMatchHighlightBackground": "#FCA31122",
    
    // Word highlight
    "editor.wordHighlightBackground": "#FCA31122",
    "editor.wordHighlightStrongBackground": "#FCA31133",
    
    // Suggest widget - matching our card colors
    "editorSuggestWidget.background": "#111113", // Card background
    "editorSuggestWidget.border": "#27272A", // Border color
    "editorSuggestWidget.foreground": "#FAFAFA",
    "editorSuggestWidget.highlightForeground": "#FCA311",
    "editorSuggestWidget.selectedBackground": "#1A1A1D", // Secondary background
    "editorSuggestWidget.focusHighlightForeground": "#FCA311",
    
    // Hover widget
    "editorHoverWidget.background": "#111113", // Card background
    "editorHoverWidget.border": "#27272A",
    "editorHoverWidget.foreground": "#FAFAFA",
    
    // Editor widget
    "editorWidget.background": "#111113",
    "editorWidget.border": "#27272A",
    
    // Gutter
    "editorGutter.background": "#0A0A0B",
    "editorGutter.addedBackground": "#10B98144",
    "editorGutter.deletedBackground": "#EF444444",
    "editorGutter.modifiedBackground": "#3B82F644",
    
    // Overview ruler
    "editorOverviewRuler.border": "#27272A",
    "editorOverviewRuler.findMatchForeground": "#FCA31166",
    "editorOverviewRuler.selectionHighlightForeground": "#FCA31166",
  }
};

/**
 * Define custom Monaco themes
 */
export function defineThemes(monaco: any) {
  monaco.editor.defineTheme("devdb-light", lightTheme);
  monaco.editor.defineTheme("devdb-dark", darkTheme);
}