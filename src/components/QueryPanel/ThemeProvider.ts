import * as monaco from "monaco-editor";

export class MonacoThemeProvider {
  private static instance: MonacoThemeProvider;

  private constructor() {}

  static getInstance(): MonacoThemeProvider {
    MonacoThemeProvider.instance = new MonacoThemeProvider();

    return MonacoThemeProvider.instance;
  }

  public createTheme(isDark: boolean): monaco.editor.IStandaloneThemeData {
    const base = isDark ? "vs-dark" : "vs";

    // Define our brand colors based on theme-usage.md
    const colors = {
      primary: "FCA311", // Amber/Orange
      secondary: "14213D", // Dark Navy
      black: "000000",
      white: "FFFFFF",
      gray: "E5E5E5",
      // Dark theme specific
      darkBg: "0a0a0a", // Near black background
      darkBgSecondary: "171717", // Slightly lighter for elevated surfaces
      darkBorder: "262626", // Subtle borders
      darkMuted: "525252", // Muted text
      // Light theme specific
      lightBg: "FFFFFF",
      lightBgSecondary: "FAFAFA",
      lightBorder: "E5E5E5",
      lightMuted: "737373",
    };

    if (isDark) {
      return {
        base,
        inherit: true,
        rules: [
          // SQL Keywords - Use primary brand color
          {
            token: "keyword.sql",
            foreground: colors.primary,
            fontStyle: "semibold",
          },
          {
            token: "keyword",
            foreground: colors.primary,
            fontStyle: "semibold",
          },

          // Strings - Green for visibility
          { token: "string.sql", foreground: "4ade80" },
          { token: "string", foreground: "4ade80" },

          // Comments - Muted gray
          {
            token: "comment.sql",
            foreground: colors.darkMuted,
            fontStyle: "italic",
          },
          {
            token: "comment",
            foreground: colors.darkMuted,
            fontStyle: "italic",
          },

          // Numbers - Light blue for contrast
          { token: "number.sql", foreground: "60a5fa" },
          { token: "number", foreground: "60a5fa" },

          // Operators - Light gray
          { token: "operator.sql", foreground: "a3a3a3" },
          { token: "operator", foreground: "a3a3a3" },

          // Functions - Purple for distinction
          {
            token: "predefined.sql",
            foreground: "c084fc",
            fontStyle: "semibold",
          },
          { token: "function.sql", foreground: "c084fc" },

          // Table names - Cyan
          { token: "type.sql", foreground: "FFE8C2" },
          { token: "table.sql", foreground: "FFE8C2" },

          // Column names and quoted identifiers - Using specified color
          { token: "identifier.sql", foreground: "06A67E" },
          { token: "identifier.quote", foreground: "06A67E" },
          { token: "variable.sql", foreground: "e5e5e5" },
        ],
        colors: {
          "editor.background": `#${colors.darkBg}`,
          "editor.foreground": `#${colors.gray}`,
          "editor.lineHighlightBackground": `#${colors.darkBgSecondary}`,
          "editor.selectionBackground": `#${colors.primary}30`,
          "editor.inactiveSelectionBackground": `#${colors.primary}20`,
          "editorCursor.foreground": `#${colors.primary}`,
          "editorWhitespace.foreground": `#${colors.darkMuted}40`,
          "editorIndentGuide.background": `#${colors.darkBorder}`,
          "editorIndentGuide.activeBackground": `#${colors.darkBorder}`,
          "editor.selectionHighlightBackground": `#${colors.primary}20`,
          "editor.findMatchBackground": `#${colors.primary}40`,
          "editor.findMatchHighlightBackground": `#${colors.primary}20`,
          "editorBracketMatch.background": `#${colors.primary}30`,
          "editorBracketMatch.border": `#${colors.primary}`,

          // Scrollbar
          "scrollbar.shadow": "#00000050",
          "scrollbarSlider.background": `#${colors.darkMuted}20`,
          "scrollbarSlider.hoverBackground": `#${colors.darkMuted}30`,
          "scrollbarSlider.activeBackground": `#${colors.darkMuted}40`,

          // Minimap
          "minimap.background": `#${colors.darkBg}`,
          "minimap.selectionHighlight": `#${colors.primary}40`,

          // Line numbers
          "editorLineNumber.foreground": `#${colors.darkMuted}`,
          "editorLineNumber.activeForeground": `#${colors.gray}`,

          // Gutter
          "editorGutter.background": `#${colors.darkBg}`,
          "editorGutter.addedBackground": "#4ade8040",
          "editorGutter.deletedBackground": "#ef444440",
          "editorGutter.modifiedBackground": "#60a5fa40",

          // Widgets (autocomplete, hover, etc)
          "editorWidget.background": `#${colors.darkBgSecondary}`,
          "editorWidget.foreground": `#${colors.gray}`,
          "editorWidget.border": `#${colors.darkBorder}`,
          "editorSuggestWidget.background": `#${colors.darkBgSecondary}`,
          "editorSuggestWidget.foreground": `#${colors.gray}`,
          "editorSuggestWidget.border": `#${colors.darkBorder}`,
          "editorSuggestWidget.highlightForeground": `#${colors.primary}`,
          "editorSuggestWidget.selectedBackground": `#${colors.primary}20`,

          // Hover
          "editorHoverWidget.background": `#${colors.darkBgSecondary}`,
          "editorHoverWidget.foreground": `#${colors.gray}`,
          "editorHoverWidget.border": `#${colors.darkBorder}`,
        },
      };
    } else {
      // Light theme
      return {
        base,
        inherit: true,
        rules: [
          // SQL Keywords
          {
            token: "keyword.sql",
            foreground: colors.primary,
            fontStyle: "semibold",
          },
          {
            token: "keyword",
            foreground: colors.primary,
            fontStyle: "semibold",
          },

          // Strings
          { token: "string.sql", foreground: "16a34a" },
          { token: "string", foreground: "16a34a" },

          // Comments
          {
            token: "comment.sql",
            foreground: colors.lightMuted,
            fontStyle: "italic",
          },
          {
            token: "comment",
            foreground: colors.lightMuted,
            fontStyle: "italic",
          },

          // Numbers
          { token: "number.sql", foreground: "2563eb" },
          { token: "number", foreground: "2563eb" },

          // Operators
          { token: "operator.sql", foreground: "171717" },
          { token: "operator", foreground: "171717" },

          // Functions
          {
            token: "predefined.sql",
            foreground: "9333ea",
            fontStyle: "semibold",
          },

          // Table names
          { token: "type.sql", foreground: "0891b2" },

          // Column names and quoted identifiers - Darker blue
          { token: "identifier.sql", foreground: "06A67E" },
          { token: "identifier.quote", foreground: "06A67E" },
          { token: "variable.sql", foreground: "171717" },
        ],
        colors: {
          "editor.background": `#${colors.lightBg}`,
          "editor.foreground": "#171717",
          "editor.lineHighlightBackground": `#${colors.lightBgSecondary}`,
          "editor.selectionBackground": `#${colors.primary}20`,
          "editor.inactiveSelectionBackground": `#${colors.primary}10`,
          "editorCursor.foreground": `#${colors.primary}`,
          "editorWhitespace.foreground": `#${colors.lightMuted}40`,
          "editorIndentGuide.background": `#${colors.lightBorder}`,
          "editorIndentGuide.activeBackground": `#${colors.lightBorder}`,
          "editor.selectionHighlightBackground": `#${colors.primary}15`,
          "editor.findMatchBackground": `#${colors.primary}30`,
          "editor.findMatchHighlightBackground": `#${colors.primary}15`,
          "editorBracketMatch.background": `#${colors.primary}20`,
          "editorBracketMatch.border": `#${colors.primary}`,

          // Scrollbar
          "scrollbar.shadow": "#00000010",
          "scrollbarSlider.background": `#${colors.lightMuted}20`,
          "scrollbarSlider.hoverBackground": `#${colors.lightMuted}30`,
          "scrollbarSlider.activeBackground": `#${colors.lightMuted}40`,

          // Line numbers
          "editorLineNumber.foreground": `#${colors.lightMuted}`,
          "editorLineNumber.activeForeground": `#${colors.secondary}`,

          // Gutter
          "editorGutter.background": `#${colors.lightBg}`,

          // Widgets
          "editorWidget.background": `#${colors.lightBg}`,
          "editorWidget.foreground": "#171717",
          "editorWidget.border": `#${colors.lightBorder}`,
          "editorSuggestWidget.background": `#${colors.lightBg}`,
          "editorSuggestWidget.foreground": "#171717",
          "editorSuggestWidget.border": `#${colors.lightBorder}`,
          "editorSuggestWidget.highlightForeground": `#${colors.secondary}`,
          "editorSuggestWidget.selectedBackground": `#${colors.primary}20`,
          "editorSuggestWidget.selectedForeground": "#171717",

          // Hover
          "editorHoverWidget.background": `#${colors.lightBg}`,
          "editorHoverWidget.foreground": "#171717",
          "editorHoverWidget.border": `#${colors.lightBorder}`,
        },
      };
    }
  }

  public applyTheme(isDark: boolean) {
    const themeName = isDark ? "devdb-dark" : "devdb-light";
    const themeData = this.createTheme(isDark);

    monaco.editor.defineTheme(themeName, themeData);
    monaco.editor.setTheme(themeName);
  }

  public initTheme() {
    // Only check for the dark class on document element - respect user preference
    const checkIsDark = () => {
      // Only check the explicit dark class set by user preference
      return document.documentElement.classList.contains("dark");
    };

    // Apply initial theme
    const isDark = checkIsDark();
    this.applyTheme(isDark);

    // Watch for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          const isDark = checkIsDark();
          this.applyTheme(isDark);
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Don't listen to system theme changes - only respect user preference

    return () => {
      observer.disconnect();
    };
  }
}
