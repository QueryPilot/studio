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

  private getCSSVariable(variable: string): string {
    const style = getComputedStyle(document.documentElement);
    const value = style.getPropertyValue(variable).trim();
    
    // Handle HSL values
    if (value.includes(' ')) {
      return `hsl(${value})`;
    }
    
    return value;
  }

  private hexToRgb(hex: string): string {
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

  private hslToHex(hslStr: string): string {
    const match = hslStr.match(/hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\)/);
    if (!match) return '#000000';
    
    const h = parseFloat(match[1]) / 360;
    const s = parseFloat(match[2]) / 100;
    const l = parseFloat(match[3]) / 100;
    
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

  private getColorHex(cssVar: string): string {
    const color = this.getCSSVariable(cssVar);
    if (color.startsWith('hsl')) {
      return this.hslToHex(color);
    }
    if (color.startsWith('#')) {
      return this.hexToRgb(color);
    }
    return '000000';
  }

  public createTheme(isDark: boolean): monaco.editor.IStandaloneThemeData {
    const base = isDark ? 'vs-dark' : 'vs';
    
    return {
      base,
      inherit: true,
      rules: [
        // SQL Keywords
        { token: 'keyword.sql', foreground: this.getColorHex('--primary') },
        { token: 'keyword', foreground: this.getColorHex('--primary') },
        
        // Strings
        { token: 'string.sql', foreground: '22c55e' },
        { token: 'string', foreground: '22c55e' },
        
        // Comments
        { token: 'comment.sql', foreground: '6b7280', fontStyle: 'italic' },
        { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
        
        // Numbers
        { token: 'number.sql', foreground: 'f97316' },
        { token: 'number', foreground: 'f97316' },
        
        // Operators
        { token: 'operator.sql', foreground: this.getColorHex('--foreground') },
        
        // Functions
        { token: 'predefined.sql', foreground: '8b5cf6', fontStyle: 'bold' },
        
        // Table names
        { token: 'type.sql', foreground: '06b6d4' },
        
        // Column names  
        { token: 'identifier.sql', foreground: this.getColorHex('--foreground') },
      ],
      colors: {
        'editor.background': '#' + this.getColorHex('--background'),
        'editor.foreground': '#' + this.getColorHex('--foreground'),
        'editor.lineHighlightBackground': '#' + this.getColorHex('--accent') + '20',
        'editor.selectionBackground': '#' + this.getColorHex('--primary') + '30',
        'editor.inactiveSelectionBackground': '#' + this.getColorHex('--primary') + '20',
        'editorCursor.foreground': '#' + this.getColorHex('--primary'),
        'editorWhitespace.foreground': '#' + this.getColorHex('--muted-foreground') + '40',
        'editorIndentGuide.background': '#' + this.getColorHex('--border'),
        'editorIndentGuide.activeBackground': '#' + this.getColorHex('--border'),
        'editor.selectionHighlightBackground': '#' + this.getColorHex('--primary') + '20',
        'editor.findMatchBackground': '#' + this.getColorHex('--primary') + '40',
        'editor.findMatchHighlightBackground': '#' + this.getColorHex('--primary') + '20',
        'editorBracketMatch.background': '#' + this.getColorHex('--primary') + '30',
        'editorBracketMatch.border': '#' + this.getColorHex('--primary'),
        
        // Scrollbar
        'scrollbar.shadow': '#00000020',
        'scrollbarSlider.background': '#' + this.getColorHex('--muted-foreground') + '20',
        'scrollbarSlider.hoverBackground': '#' + this.getColorHex('--muted-foreground') + '30',
        'scrollbarSlider.activeBackground': '#' + this.getColorHex('--muted-foreground') + '40',
        
        // Minimap
        'minimap.background': '#' + this.getColorHex('--background'),
        'minimap.selectionHighlight': '#' + this.getColorHex('--primary') + '40',
        
        // Line numbers
        'editorLineNumber.foreground': '#' + this.getColorHex('--muted-foreground') + '80',
        'editorLineNumber.activeForeground': '#' + this.getColorHex('--foreground'),
        
        // Gutter
        'editorGutter.background': '#' + this.getColorHex('--background'),
        'editorGutter.addedBackground': '#22c55e40',
        'editorGutter.deletedBackground': '#ef444440',
        'editorGutter.modifiedBackground': '#3b82f640',
        
        // Widgets
        'editorWidget.background': '#' + this.getColorHex('--popover'),
        'editorWidget.foreground': '#' + this.getColorHex('--popover-foreground'),
        'editorWidget.border': '#' + this.getColorHex('--border'),
        'editorSuggestWidget.background': '#' + this.getColorHex('--popover'),
        'editorSuggestWidget.foreground': '#' + this.getColorHex('--popover-foreground'),
        'editorSuggestWidget.border': '#' + this.getColorHex('--border'),
        'editorSuggestWidget.highlightForeground': '#' + this.getColorHex('--primary'),
        'editorSuggestWidget.selectedBackground': '#' + this.getColorHex('--accent'),
        
        // Hover
        'editorHoverWidget.background': '#' + this.getColorHex('--popover'),
        'editorHoverWidget.foreground': '#' + this.getColorHex('--popover-foreground'),
        'editorHoverWidget.border': '#' + this.getColorHex('--border'),
      },
    };
  }

  public applyTheme(isDark: boolean) {
    const themeName = isDark ? 'devdb-dark' : 'devdb-light';
    const themeData = this.createTheme(isDark);
    
    monaco.editor.defineTheme(themeName, themeData);
    monaco.editor.setTheme(themeName);
  }

  public initTheme() {
    // Check current theme
    const isDark = document.documentElement.classList.contains('dark');
    this.applyTheme(isDark);
    
    // Watch for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isDark = document.documentElement.classList.contains('dark');
          this.applyTheme(isDark);
        }
      });
    });
    
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    
    return () => observer.disconnect();
  }
}