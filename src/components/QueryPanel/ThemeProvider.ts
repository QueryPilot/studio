import * as monaco from 'monaco-editor';

export class MonacoThemeProvider {
  private static instance: MonacoThemeProvider;

  private constructor() {}

  static getInstance(): MonacoThemeProvider {
    if (!MonacoThemeProvider.instance) {
      MonacoThemeProvider.instance = new MonacoThemeProvider();
    }
    return MonacoThemeProvider.instance;
  }

  private _getCSSVariable(variable: string): string {
    const style = getComputedStyle(document.documentElement);
    const value = style.getPropertyValue(variable).trim();
    
    // Handle HSL values
    if (value.includes(' ')) {
      return `hsl(${value})`;
    }
    
    return value;
  }

  private _hexToRgb(hex: string): string {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Convert 3-digit hex to 6-digit
    if (hex.length === 3) {
      hex = hex.split('').map(char => char + char).join('');
    }
    
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    return `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  private _hslToHex(hslStr: string): string {
    const match = hslStr.match(/hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\)/);
    if (!match) return '#000000';
    
    const h = parseFloat(match[1] || '0') / 360;
    const s = parseFloat(match[2] || '0') / 100;
    const l = parseFloat(match[3] || '0') / 100;
    
    let r, g, b;
    
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    const toHex = (x: number) => {
      const hex = Math.round(x * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return `${toHex(r)}${toHex(g)}${toHex(b)}`;
  }


  public createTheme(isDark: boolean): monaco.editor.IStandaloneThemeData {
    const base = isDark ? 'vs-dark' : 'vs';
    
    // Define our brand colors based on theme-usage.md
    const colors = {
      primary: 'FCA311', // Amber/Orange
      secondary: '14213D', // Dark Navy
      black: '000000',
      white: 'FFFFFF',
      gray: 'E5E5E5',
      // Dark theme specific
      darkBg: '0a0a0a', // Near black background
      darkBgSecondary: '171717', // Slightly lighter for elevated surfaces
      darkBorder: '262626', // Subtle borders
      darkMuted: '525252', // Muted text
      // Light theme specific  
      lightBg: 'FFFFFF',
      lightBgSecondary: 'FAFAFA',
      lightBorder: 'E5E5E5',
      lightMuted: '737373',
    };
    
    if (isDark) {
      return {
        base,
        inherit: true,
        rules: [
          // SQL Keywords - Use primary brand color
          { token: 'keyword.sql', foreground: colors.primary, fontStyle: 'bold' },
          { token: 'keyword', foreground: colors.primary, fontStyle: 'bold' },
          
          // Strings - Green for visibility
          { token: 'string.sql', foreground: '4ade80' },
          { token: 'string', foreground: '4ade80' },
          
          // Comments - Muted gray
          { token: 'comment.sql', foreground: colors.darkMuted, fontStyle: 'italic' },
          { token: 'comment', foreground: colors.darkMuted, fontStyle: 'italic' },
          
          // Numbers - Light blue for contrast
          { token: 'number.sql', foreground: '60a5fa' },
          { token: 'number', foreground: '60a5fa' },
          
          // Operators - Light gray
          { token: 'operator.sql', foreground: 'a3a3a3' },
          { token: 'operator', foreground: 'a3a3a3' },
          
          // Functions - Purple for distinction
          { token: 'predefined.sql', foreground: 'c084fc', fontStyle: 'bold' },
          { token: 'function.sql', foreground: 'c084fc' },
          
          // Table names - Cyan
          { token: 'type.sql', foreground: '67e8f9' },
          { token: 'table.sql', foreground: '67e8f9' },
          
          // Column names - White  
          { token: 'identifier.sql', foreground: 'e5e5e5' },
          { token: 'variable.sql', foreground: 'e5e5e5' },
        ],
        colors: {
          'editor.background': `#${colors.darkBg}`,
          'editor.foreground': `#${colors.gray}`,
          'editor.lineHighlightBackground': `#${colors.darkBgSecondary}`,
          'editor.selectionBackground': `#${colors.primary}30`,
          'editor.inactiveSelectionBackground': `#${colors.primary}20`,
          'editorCursor.foreground': `#${colors.primary}`,
          'editorWhitespace.foreground': `#${colors.darkMuted}40`,
          'editorIndentGuide.background': `#${colors.darkBorder}`,
          'editorIndentGuide.activeBackground': `#${colors.darkBorder}`,
          'editor.selectionHighlightBackground': `#${colors.primary}20`,
          'editor.findMatchBackground': `#${colors.primary}40`,
          'editor.findMatchHighlightBackground': `#${colors.primary}20`,
          'editorBracketMatch.background': `#${colors.primary}30`,
          'editorBracketMatch.border': `#${colors.primary}`,
          
          // Scrollbar
          'scrollbar.shadow': '#00000050',
          'scrollbarSlider.background': `#${colors.darkMuted}20`,
          'scrollbarSlider.hoverBackground': `#${colors.darkMuted}30`,
          'scrollbarSlider.activeBackground': `#${colors.darkMuted}40`,
          
          // Minimap
          'minimap.background': `#${colors.darkBg}`,
          'minimap.selectionHighlight': `#${colors.primary}40`,
          
          // Line numbers
          'editorLineNumber.foreground': `#${colors.darkMuted}`,
          'editorLineNumber.activeForeground': `#${colors.gray}`,
          
          // Gutter
          'editorGutter.background': `#${colors.darkBg}`,
          'editorGutter.addedBackground': '#4ade8040',
          'editorGutter.deletedBackground': '#ef444440',
          'editorGutter.modifiedBackground': '#60a5fa40',
          
          // Widgets (autocomplete, hover, etc)
          'editorWidget.background': `#${colors.darkBgSecondary}`,
          'editorWidget.foreground': `#${colors.gray}`,
          'editorWidget.border': `#${colors.darkBorder}`,
          'editorSuggestWidget.background': `#${colors.darkBgSecondary}`,
          'editorSuggestWidget.foreground': `#${colors.gray}`,
          'editorSuggestWidget.border': `#${colors.darkBorder}`,
          'editorSuggestWidget.highlightForeground': `#${colors.primary}`,
          'editorSuggestWidget.selectedBackground': `#${colors.primary}20`,
          
          // Hover
          'editorHoverWidget.background': `#${colors.darkBgSecondary}`,
          'editorHoverWidget.foreground': `#${colors.gray}`,
          'editorHoverWidget.border': `#${colors.darkBorder}`,
        },
      };
    } else {
      // Light theme
      return {
        base,
        inherit: true,
        rules: [
          // SQL Keywords
          { token: 'keyword.sql', foreground: colors.primary, fontStyle: 'bold' },
          { token: 'keyword', foreground: colors.primary, fontStyle: 'bold' },
          
          // Strings
          { token: 'string.sql', foreground: '16a34a' },
          { token: 'string', foreground: '16a34a' },
          
          // Comments
          { token: 'comment.sql', foreground: colors.lightMuted, fontStyle: 'italic' },
          { token: 'comment', foreground: colors.lightMuted, fontStyle: 'italic' },
          
          // Numbers
          { token: 'number.sql', foreground: '2563eb' },
          { token: 'number', foreground: '2563eb' },
          
          // Operators
          { token: 'operator.sql', foreground: '525252' },
          
          // Functions
          { token: 'predefined.sql', foreground: '9333ea', fontStyle: 'bold' },
          
          // Table names
          { token: 'type.sql', foreground: '0891b2' },
          
          // Column names  
          { token: 'identifier.sql', foreground: '171717' },
        ],
        colors: {
          'editor.background': `#${colors.lightBg}`,
          'editor.foreground': `#${colors.secondary}`,
          'editor.lineHighlightBackground': `#${colors.lightBgSecondary}`,
          'editor.selectionBackground': `#${colors.primary}20`,
          'editor.inactiveSelectionBackground': `#${colors.primary}10`,
          'editorCursor.foreground': `#${colors.primary}`,
          'editorWhitespace.foreground': `#${colors.lightMuted}40`,
          'editorIndentGuide.background': `#${colors.lightBorder}`,
          'editorIndentGuide.activeBackground': `#${colors.lightBorder}`,
          'editor.selectionHighlightBackground': `#${colors.primary}15`,
          'editor.findMatchBackground': `#${colors.primary}30`,
          'editor.findMatchHighlightBackground': `#${colors.primary}15`,
          'editorBracketMatch.background': `#${colors.primary}20`,
          'editorBracketMatch.border': `#${colors.primary}`,
          
          // Scrollbar
          'scrollbar.shadow': '#00000010',
          'scrollbarSlider.background': `#${colors.lightMuted}20`,
          'scrollbarSlider.hoverBackground': `#${colors.lightMuted}30`,
          'scrollbarSlider.activeBackground': `#${colors.lightMuted}40`,
          
          // Line numbers
          'editorLineNumber.foreground': `#${colors.lightMuted}`,
          'editorLineNumber.activeForeground': `#${colors.secondary}`,
          
          // Gutter
          'editorGutter.background': `#${colors.lightBg}`,
          
          // Widgets
          'editorWidget.background': `#${colors.lightBg}`,
          'editorWidget.foreground': `#${colors.secondary}`,
          'editorWidget.border': `#${colors.lightBorder}`,
          'editorSuggestWidget.background': `#${colors.lightBg}`,
          'editorSuggestWidget.foreground': `#${colors.secondary}`,
          'editorSuggestWidget.border': `#${colors.lightBorder}`,
          'editorSuggestWidget.highlightForeground': `#${colors.primary}`,
          'editorSuggestWidget.selectedBackground': `#${colors.primary}15`,
          
          // Hover
          'editorHoverWidget.background': `#${colors.lightBg}`,
          'editorHoverWidget.foreground': `#${colors.secondary}`,
          'editorHoverWidget.border': `#${colors.lightBorder}`,
        },
      };
    }
  }

  public applyTheme(isDark: boolean) {
    const themeName = isDark ? 'devdb-dark' : 'devdb-light';
    const themeData = this.createTheme(isDark);
    
    monaco.editor.defineTheme(themeName, themeData);
    monaco.editor.setTheme(themeName);
  }

  public initTheme() {
    // Only check for the dark class on document element - respect user preference
    const checkIsDark = () => {
      // Only check the explicit dark class set by user preference
      return document.documentElement.classList.contains('dark');
    };
    
    // Apply initial theme
    const isDark = checkIsDark();
    this.applyTheme(isDark);
    
    // Watch for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isDark = checkIsDark();
          this.applyTheme(isDark);
        }
      });
    });
    
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    
    // Don't listen to system theme changes - only respect user preference
    
    return () => {
      observer.disconnect();
    };
  }
}