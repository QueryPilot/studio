import type { Theme } from "@glideapps/glide-data-grid";

/**
 * DataGrid theme using oklch-based color palette
 *
 * Color mappings from globals.css:
 * - Primary: oklch(0.79 0.145 77) ≈ #D4A52B (warm golden)
 * - Dark bg: #110F0C (very dark warm)
 * - Dark card: #1A1714 (dark warm surface)
 * - Dark muted: #252220 (dark warm elevated)
 * - Dark foreground: oklch(0.93 0.008 80) ≈ #EDE9E3
 * - Light bg: oklch(0.98 0.005 80) ≈ #FAF9F7
 * - Light foreground: oklch(0.17 0.008 80) ≈ #27231E
 */
export const createDataGridTheme = (appTheme: string): Partial<Theme> => {
  const isDark = appTheme === "dark";

  return {
    // Accent colors - primary oklch(0.79 0.145 77)
    accentColor: "#D4A52B",
    accentLight: "rgba(212, 165, 43, 0.1)",
    accentFg: "#110F0C",

    // Text colors matching oklch theme
    textDark: isDark ? "#EBE7E2" : "#27231E",
    textMedium: isDark ? "rgba(235, 231, 226, 0.7)" : "rgba(39, 35, 30, 0.7)",
    textLight: isDark ? "rgba(235, 231, 226, 0.5)" : "rgba(39, 35, 30, 0.5)",
    textBubble: isDark ? "#EBE7E2" : "#27231E",

    // Header colors
    bgIconHeader: isDark ? "#24211C" : "#EEEBE5",
    fgIconHeader: isDark ? "#EBE7E2" : "#27231E",
    textHeader: isDark ? "#EBE7E2" : "#27231E",
    textHeaderSelected: "#110F0C",

    // Cell backgrounds - dark: #110F0C, light: #FAF8F5
    bgCell: isDark ? "#110F0C" : "#FAF8F5",
    bgCellMedium: isDark ? "#15120F" : "#F5F3F0",
    bgHeader: isDark ? "#24211C" : "#EEEBE5",
    bgHeaderHasFocus: isDark ? "#24211C" : "#EEEBE5",
    bgHeaderHovered: isDark ? "#2E2A25" : "#E5E2DC",

    // Other backgrounds
    bgBubble: isDark ? "#2E2A25" : "#EEEBE5",
    bgBubbleSelected: "#D4A52B",

    bgSearchResult: "rgba(212, 165, 43, 0.2)",

    // Borders - using theme border colors
    borderColor: isDark ? "rgba(237, 233, 227, 0.1)" : "rgba(39, 35, 30, 0.1)",
    horizontalBorderColor: isDark
      ? "rgba(237, 233, 227, 0.05)"
      : "rgba(39, 35, 30, 0.05)",
    drilldownBorder: isDark
      ? "rgba(237, 233, 227, 0.2)"
      : "rgba(39, 35, 30, 0.2)",
    linkColor: "#D4A52B",

    cellHorizontalPadding: 8,
    cellVerticalPadding: 4,

    headerFontStyle: "600 12px",
    baseFontStyle: "400 12px",
    editorFontSize: "12px",
    lineHeight: 1.5,

    fontFamily: [
      "Noto Sans Variable",
      "Noto Sans",
      "-apple-system",
      "BlinkMacSystemFont",
      "Segoe UI",
      "Helvetica",
      "Arial",
      "sans-serif",
    ].join(", "),
  };
};
