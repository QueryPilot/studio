import type { Theme } from "@glideapps/glide-data-grid";

export const createDataGridTheme = (appTheme: string): Partial<Theme> => {
  const isDark = appTheme === "dark";

  return {
    // Accent colors using our brand colors
    accentColor: "#FCA311", // Primary brand color
    accentLight: "rgba(252, 163, 17, 0.1)",
    accentFg: "#09090B",

    // Text colors matching our theme
    textDark: isDark ? "#AEACA8" : "#09090B",
    textMedium: isDark ? "rgba(229, 229, 229, 0.7)" : "rgba(0, 0, 0, 0.7)",
    textLight: isDark ? "rgba(229, 229, 229, 0.5)" : "rgba(0, 0, 0, 0.5)",
    textBubble: isDark ? "#AEACA8" : "#09090B",

    // Header colors
    bgIconHeader: isDark ? "#14213D" : "#F5F5F5",
    fgIconHeader: isDark ? "#D1D5DB" : "#111827",
    textHeader: isDark ? "#D1D5DB" : "#111827",
    textHeaderSelected: isDark ? "#F3F4F6" : "#111827",
    // bgHeaderSelected: "transparent",

    // Cell backgrounds matching our surface colors
    bgCell: isDark ? "#09090B" : "#FFFFFF",
    bgCellMedium: isDark ? "#0A0A0A" : "#FAFAFA",
    bgHeader: isDark ? "#1C1C21" : "#F5F5F5",
    bgHeaderHasFocus: isDark ? "#1C1C21" : "#F5F5F5",
    bgHeaderHovered: isDark ? "#2A2A30" : "#E8E8E8",

    // Other backgrounds
    bgBubble: isDark ? "#14213D" : "#F5F5F5",
    bgBubbleSelected: "#FCA311",

    // Row selection highlight
    // bgCellSelected: isDark
    //   ? "rgba(252, 163, 17, 0.1)"
    //   : "rgba(252, 163, 17, 0.05)",
    // bgCellSelectedMedium: isDark
    //   ? "rgba(252, 163, 17, 0.15)"
    //   : "rgba(252, 163, 17, 0.08)",

    bgSearchResult: "rgba(252, 163, 17, 0.2)",

    // Borders
    borderColor: isDark ? "rgba(229, 229, 229, 0.1)" : "rgba(0, 0, 0, 0.1)",
    horizontalBorderColor: isDark
      ? "rgba(229, 229, 229, 0.05)"
      : "rgba(0, 0, 0, 0.05)",
    drilldownBorder: isDark ? "rgba(229, 229, 229, 0.2)" : "rgba(0, 0, 0, 0.2)",
    linkColor: "#FCA311",

    cellHorizontalPadding: 8,
    cellVerticalPadding: 4,

    headerFontStyle: "600 12px",
    baseFontStyle: "400 12px",
    editorFontSize: "12px",
    lineHeight: 1.5,

    fontFamily: [
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
