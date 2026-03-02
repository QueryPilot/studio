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

// SQL Hover tooltip theme
export const createSqlHoverTheme = (isDark: boolean): Extension => {
  return EditorView.baseTheme({
    ".cm-tooltip.cm-tooltip-hover": {
      zIndex: "10000 !important",
      border: "none !important",
      backgroundColor: "transparent !important",
      backgroundImage: "none !important",
    },
    ".cm-sql-hover-tooltip": {
      backgroundColor: isDark ? "#1e1e1e" : "#ffffff",
      color: isDark ? "#e0e0e0" : "#1e1e1e",
      border: `1px solid ${isDark ? "#3c3c3c" : "#d0d0d0"}`,
      borderRadius: "8px",
      padding: "12px",
      boxShadow: isDark
        ? "0 4px 16px rgba(0, 0, 0, 0.4)"
        : "0 4px 16px rgba(0, 0, 0, 0.1)",
      fontSize: "13px",
      fontFamily: "'Inter', -apple-system, sans-serif",
      maxWidth: "400px",
      zIndex: "10000",
    },
    ".cm-sql-hover-header": {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      marginBottom: "8px",
      paddingBottom: "8px",
      borderBottom: `1px solid ${isDark ? "#333" : "#e5e5e5"}`,
    },
    ".cm-sql-hover-type": {
      fontSize: "10px",
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      color: "#D4A52B",
      backgroundColor: isDark ? "#2a2520" : "#fef3e2",
      padding: "2px 6px",
      borderRadius: "4px",
    },
    ".cm-sql-hover-name": {
      fontWeight: "600",
      fontSize: "14px",
      color: isDark ? "#f0f0f0" : "#1e1e1e",
    },
    ".cm-sql-hover-body": {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
    },
    ".cm-sql-hover-info-row": {
      fontSize: "12px",
      color: isDark ? "#b0b0b0" : "#666",
    },
    ".cm-sql-hover-hint": {
      fontSize: "11px",
      color: isDark ? "#888" : "#999",
      fontStyle: "italic",
      marginTop: "4px",
      paddingTop: "8px",
      borderTop: `1px solid ${isDark ? "#2a2a2a" : "#f0f0f0"}`,
    },
    ".cm-sql-hover-col-type-main": {
      fontSize: "13px",
      color: "#06B6D4",
      fontFamily: "'JetBrains Mono', monospace",
    },
    ".cm-sql-hover-badge": {
      fontSize: "9px",
      fontWeight: "600",
      padding: "2px 5px",
      borderRadius: "3px",
      textTransform: "uppercase",
      letterSpacing: "0.3px",
    },
    ".cm-sql-hover-badge.pk": {
      backgroundColor: "#22C55E22",
      color: "#22C55E",
    },
    ".cm-sql-hover-badge.not-null": {
      backgroundColor: "#F472B622",
      color: "#F472B6",
    },
    ".cm-sql-hover-columns": {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      marginTop: "4px",
    },
    ".cm-sql-hover-column": {
      display: "flex",
      justifyContent: "space-between",
      gap: "12px",
      fontSize: "12px",
      padding: "4px 8px",
      backgroundColor: isDark ? "#252525" : "#f8f8f8",
      borderRadius: "4px",
    },
    ".cm-sql-hover-col-name": {
      fontFamily: "'JetBrains Mono', monospace",
      color: isDark ? "#e0e0e0" : "#333",
    },
    ".cm-sql-hover-col-type": {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "11px",
      color: isDark ? "#888" : "#666",
    },
    ".cm-sql-hover-col-count": {
      fontSize: "12px",
      color: isDark ? "#999" : "#666",
      marginBottom: "4px",
    },
    ".cm-sql-hover-row-count": {
      fontSize: "12px",
      color: "#D4A52B",
      fontWeight: "500",
    },
    ".cm-sql-hover-more": {
      fontSize: "11px",
      color: isDark ? "#666" : "#999",
      textAlign: "center",
      padding: "4px",
      fontStyle: "italic",
    },
    ".cm-sql-hover-description": {
      fontSize: "12px",
      color: isDark ? "#b0b0b0" : "#555",
      marginTop: "6px",
      lineHeight: "1.5",
      paddingTop: "6px",
      borderTop: `1px solid ${isDark ? "#2a2a2a" : "#f0f0f0"}`,
    },
  });
};

// Lint tooltip theme (matches shadcn/ui design system)
export const createLintTooltipTheme = (isDark: boolean): Extension => {
  const bgColor = isDark ? "#171717" : "#ffffff"; // solid colors, no transparency
  const borderColor = isDark ? "#262626" : "#e5e5e5";

  return EditorView.baseTheme({
    // Main lint tooltip container with multiple selectors for specificity
    ".cm-tooltip-lint, .cm-tooltip.cm-tooltip-lint": {
      backgroundColor: `${bgColor} !important`,
      backgroundImage: "none !important",
      border: `1px solid ${borderColor} !important`,
      borderRadius: "8px !important",
      padding: "8px 12px !important",
      boxShadow: isDark
        ? "0 4px 16px rgba(0, 0, 0, 0.5) !important"
        : "0 4px 12px rgba(0, 0, 0, 0.1) !important",
      fontSize: "13px !important",
      fontFamily: "'Inter', -apple-system, sans-serif !important",
      width: "min(460px, 78vw) !important",
      maxWidth: "460px !important",
      maxHeight: "48vh !important",
      overflowY: "auto !important",
      overflowX: "hidden !important",
      userSelect: "text !important",
      WebkitUserSelect: "text !important",
      pointerEvents: "auto !important",
      zIndex: "10000 !important",
    },
    // Individual diagnostic messages
    ".cm-diagnostic": {
      padding: "6px 0",
      borderBottom: `1px solid ${isDark ? "hsl(0 0% 15%)" : "hsl(0 0% 93%)"}`,
      color: isDark ? "hsl(0 0% 85%)" : "hsl(0 0% 20%)",
      lineHeight: "1.5",
      whiteSpace: "normal",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
      userSelect: "text",
      WebkitUserSelect: "text",
      pointerEvents: "auto",
    },
    ".cm-diagnosticText, .cm-diagnosticSource": {
      whiteSpace: "normal",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
      userSelect: "text",
      WebkitUserSelect: "text",
    },
    ".cm-diagnostic:last-child": {
      borderBottom: "none",
    },
    // Error severity
    ".cm-diagnostic-error": {
      borderLeftColor: "hsl(0 84% 60%)", // destructive red
      borderLeftWidth: "3px",
      borderLeftStyle: "solid",
      paddingLeft: "8px",
    },
    ".cm-diagnostic-error::before": {
      content: '"ERROR: "',
      fontWeight: "600",
      fontSize: "11px",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      color: "hsl(0 84% 60%)",
      marginRight: "6px",
    },
    // Warning severity
    ".cm-diagnostic-warning": {
      borderLeftColor: "hsl(45 93% 47%)", // amber/yellow
      borderLeftWidth: "3px",
      borderLeftStyle: "solid",
      paddingLeft: "8px",
    },
    ".cm-diagnostic-warning::before": {
      content: '"WARNING: "',
      fontWeight: "600",
      fontSize: "11px",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      color: "hsl(45 93% 47%)",
      marginRight: "6px",
    },
    // Info severity
    ".cm-diagnostic-info": {
      borderLeftColor: "hsl(221 83% 53%)", // primary blue
      borderLeftWidth: "3px",
      borderLeftStyle: "solid",
      paddingLeft: "8px",
    },
    ".cm-diagnostic-info::before": {
      content: '"INFO: "',
      fontWeight: "600",
      fontSize: "11px",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      color: "hsl(221 83% 53%)",
      marginRight: "6px",
    },
    // Hint severity (same as info)
    ".cm-diagnostic-hint": {
      borderLeftColor: "hsl(221 83% 53%)",
      borderLeftWidth: "3px",
      borderLeftStyle: "solid",
      paddingLeft: "8px",
    },
    ".cm-diagnostic-hint::before": {
      content: '"HINT: "',
      fontWeight: "600",
      fontSize: "11px",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      color: "hsl(221 83% 53%)",
      marginRight: "6px",
    },
    // Action buttons in tooltip
    ".cm-diagnosticAction": {
      marginTop: "8px",
      padding: "4px 8px",
      backgroundColor: isDark ? "hsl(0 0% 15%)" : "hsl(0 0% 96%)",
      border: `1px solid ${isDark ? "hsl(0 0% 20%)" : "hsl(0 0% 90%)"}`,
      borderRadius: "4px",
      fontSize: "12px",
      cursor: "pointer",
      transition: "all 0.15s",
      color: isDark ? "hsl(0 0% 90%)" : "hsl(0 0% 10%)",
    },
    ".cm-diagnosticAction:hover": {
      backgroundColor: isDark ? "hsl(0 0% 20%)" : "hsl(0 0% 90%)",
      borderColor: "hsl(221 83% 53%)",
    },
  });
};

// Search panel theme - VS Code-style floating widget
export const createSearchPanelTheme = (isDark: boolean): Extension => {
  const bg = isDark ? "#1A1714" : "#FFFFFF";
  const fg = isDark ? "#EBE7E2" : "#27231E";
  const border = isDark ? "#3D3830" : "#DDD8CF";
  const inputBg = isDark ? "#2E2A24" : "rgba(221, 216, 207, 0.12)";
  const muted = "#7A756C";
  const accentBg = isDark ? "#352F28" : "#E8E2D8";
  const accentFg = isDark ? "#EBE7E2" : "#27231E";
  const hoverBg = isDark
    ? "rgba(46, 42, 36, 0.5)"
    : "rgba(221, 216, 207, 0.3)";

  return EditorView.theme({
    // Make the panels container not take vertical space
    ".cm-panels.cm-panels-top": {
      backgroundColor: "transparent !important",
      borderBottom: "none !important",
      position: "absolute !important" as string,
      top: "0",
      right: "0",
      left: "auto !important" as string,
      zIndex: "10",
      pointerEvents: "none",
    },

    // Floating search panel container
    ".cm-panel.cm-search": {
      pointerEvents: "auto",
      position: "relative",
      width: "340px",
      margin: "4px 16px 0 0",
      padding: "8px !important",
      backgroundColor: `${bg} !important`,
      border: `1px solid ${border} !important`,
      borderRadius: "8px !important",
      boxShadow: isDark
        ? "0 4px 16px rgba(0, 0, 0, 0.4)"
        : "0 4px 12px rgba(0, 0, 0, 0.1)",
      fontFamily: "'Inter', -apple-system, sans-serif",
      fontSize: "12px",
      color: fg,
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "4px",
    },

    // Override the catch-all margin on inputs/buttons/labels
    ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label":
      {
        margin: "0 !important",
      },

    // Text inputs (Find / Replace)
    ".cm-panel.cm-search .cm-textfield": {
      flex: "1",
      minWidth: "0",
      height: "24px",
      padding: "0 8px",
      backgroundColor: inputBg,
      border: `1px solid ${border}`,
      borderRadius: "6px",
      color: fg,
      fontSize: "12px",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      outline: "none",
      transition: "border-color 0.15s, box-shadow 0.15s",
    },
    ".cm-panel.cm-search .cm-textfield:focus": {
      borderColor: "#D4A52B",
      boxShadow: "0 0 0 2px rgba(212, 165, 43, 0.3)",
    },
    ".cm-panel.cm-search .cm-textfield::placeholder": {
      color: muted,
    },

    // Action buttons (next, previous, all, replace, replace all)
    ".cm-panel.cm-search .cm-button": {
      height: "24px",
      padding: "0 8px",
      backgroundColor: "transparent",
      border: "1px solid transparent",
      borderRadius: "6px",
      color: fg,
      fontSize: "11px",
      fontWeight: "500",
      cursor: "pointer",
      transition: "all 0.15s",
      whiteSpace: "nowrap",
    },
    ".cm-panel.cm-search .cm-button:hover": {
      backgroundColor: hoverBg,
    },
    ".cm-panel.cm-search .cm-button:active": {
      backgroundColor: accentBg,
    },

    // Close button - icon style, top-right
    ".cm-panel.cm-search [name=close]": {
      position: "absolute !important" as string,
      top: "6px",
      right: "6px",
      width: "20px",
      height: "20px",
      padding: "0 !important",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "4px",
      fontSize: "14px",
      color: muted,
      backgroundColor: "transparent !important",
      border: "none !important",
      cursor: "pointer",
      transition: "all 0.15s",
    },
    ".cm-panel.cm-search [name=close]:hover": {
      backgroundColor: `${hoverBg} !important`,
      color: `${fg} !important`,
    },

    // Checkbox labels - compact toggle style
    ".cm-panel.cm-search label": {
      display: "inline-flex !important",
      alignItems: "center",
      gap: "2px",
      height: "24px",
      padding: "0 6px",
      borderRadius: "6px",
      fontSize: "11px !important",
      color: muted,
      cursor: "pointer",
      transition: "all 0.15s",
      whiteSpace: "nowrap !important",
    },
    ".cm-panel.cm-search label:hover": {
      backgroundColor: hoverBg,
      color: fg,
    },
    ".cm-panel.cm-search label:has(input:checked)": {
      backgroundColor: accentBg,
      color: accentFg,
    },

    // Checkbox inputs - smaller
    ".cm-panel.cm-search input[type=checkbox]": {
      width: "12px",
      height: "12px",
      accentColor: "#D4A52B",
    },

    // Hide the <br> between find and replace rows - use flexbox wrapping instead
    ".cm-panel.cm-search br": {
      display: "none",
    },

    // Replace row inputs - full width on new line
    ".cm-panel.cm-search .cm-textfield[name=replace]": {
      flexBasis: "100%",
      marginTop: "4px",
    },
    // Replace buttons
    ".cm-panel.cm-search .cm-button[name=replace]": {
      marginTop: "4px",
    },
    ".cm-panel.cm-search .cm-button[name=replaceAll]": {
      marginTop: "4px",
    },

    // Search match highlights - golden theme
    ".cm-searchMatch": {
      backgroundColor: "rgba(212, 165, 43, 0.2) !important",
      borderRadius: "2px",
    },
    ".cm-searchMatch-selected": {
      backgroundColor: "rgba(212, 165, 43, 0.45) !important",
    },
  });
};

// Get theme extensions based on theme mode
export const getThemeExtensions = (theme: "light" | "dark"): Extension[] => {
  const isDark = theme === "dark";

  return [
    isDark ? createDarkTheme() : createLightTheme(),
    createFoldGutterTheme(isDark),
    createSqlHoverTheme(isDark),
    createLintTooltipTheme(isDark),
    createSearchPanelTheme(isDark),
  ];
};
