import type { Theme } from "@glideapps/glide-data-grid";

/**
 * DataGrid theme aligned with globals.css oklch color palette
 *
 * Color mappings (verified via oklch→sRGB conversion):
 * - Primary: oklch(0.75 0.16 70) = #ED990E (rich amber)
 * - Light background: oklch(0.98 0.005 80) = #FAF8F5
 * - Dark background: oklch(0.17 0.008 80) = #110F0C
 * - Light foreground: oklch(0.17 0.008 80) = #110F0C
 * - Dark foreground: oklch(0.93 0.008 80) = #EBE7E2
 * - Light muted: oklch(0.94 0.008 80) = #EEEBE5
 * - Dark muted: oklch(0.25 0.01 80) = #24211C
 * - Light border: oklch(0.88 0.02 80) = #DED6C9
 * - Dark border: oklch(0.32 0.015 80) = #37322A
 */
export const createDataGridTheme = (appTheme: string): Partial<Theme> => {
  const isDark = appTheme === "dark";

  return {
    // Accent colors - primary oklch(0.75 0.16 70) = #ED990E
    accentColor: "#ED990E",
    accentLight: "rgba(237, 153, 14, 0.1)",
    accentFg: "#110F0C",

    // Text colors matching oklch theme
    textDark: isDark ? "#EBE7E2" : "#110F0C",
    textMedium: isDark ? "rgba(235, 231, 226, 0.7)" : "rgba(17, 15, 12, 0.7)",
    textLight: isDark ? "rgba(235, 231, 226, 0.5)" : "rgba(17, 15, 12, 0.5)",
    textBubble: isDark ? "#EBE7E2" : "#110F0C",

    // Header colors - using muted oklch(0.94/0.25)
    bgIconHeader: isDark ? "#24211C" : "#EEEBE5",
    fgIconHeader: isDark ? "#EBE7E2" : "#110F0C",
    textHeader: isDark ? "#EBE7E2" : "#110F0C",
    textHeaderSelected: "#110F0C",

    // Cell backgrounds - dark: oklch(0.17) = #110F0C, light: oklch(0.98) = #FAF8F5
    bgCell: isDark ? "#110F0C" : "#FAF8F5",
    bgCellMedium: isDark ? "#1A1714" : "#F5F2ED",
    bgHeader: isDark ? "#24211C" : "#EEEBE5",
    bgHeaderHasFocus: isDark ? "#24211C" : "#EEEBE5",
    bgHeaderHovered: isDark ? "#37322A" : "#DED6C9",

    // Other backgrounds
    bgBubble: isDark ? "#24211C" : "#EEEBE5",
    bgBubbleSelected: "#ED990E",

    bgSearchResult: "rgba(237, 153, 14, 0.2)",

    // Borders - using theme border colors oklch(0.88/0.32)
    borderColor: isDark ? "rgba(235, 231, 226, 0.1)" : "rgba(17, 15, 12, 0.1)",
    horizontalBorderColor: isDark
      ? "rgba(235, 231, 226, 0.05)"
      : "rgba(17, 15, 12, 0.05)",
    drilldownBorder: isDark
      ? "rgba(235, 231, 226, 0.2)"
      : "rgba(17, 15, 12, 0.2)",
    linkColor: "#ED990E",

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
