import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Configure the Monaco loader to use the local Monaco instance
loader.config({ monaco });

// Initialize and get Monaco instance
export const initMonaco = async () => {
  const monacoInstance = await loader.init();
  
  // Define our custom themes immediately when Monaco loads
  const isDark = document.documentElement.classList.contains('dark') || 
                 window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // Define dark theme
  monacoInstance.editor.defineTheme('devdb-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      // SQL Keywords - Use primary brand color
      { token: 'keyword.sql', foreground: 'FCA311', fontStyle: 'bold' },
      { token: 'keyword', foreground: 'FCA311', fontStyle: 'bold' },
      
      // Strings - Green for visibility
      { token: 'string.sql', foreground: '4ade80' },
      { token: 'string', foreground: '4ade80' },
      
      // Comments - Muted gray
      { token: 'comment.sql', foreground: '525252', fontStyle: 'italic' },
      { token: 'comment', foreground: '525252', fontStyle: 'italic' },
      
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
      'editor.background': '#0a0a0a',
      'editor.foreground': '#e5e5e5',
      'editor.lineHighlightBackground': '#171717',
      'editor.selectionBackground': '#FCA31130',
      'editor.inactiveSelectionBackground': '#FCA31120',
      'editorCursor.foreground': '#FCA311',
      'editorWhitespace.foreground': '#52525240',
      'editorIndentGuide.background': '#262626',
      'editorIndentGuide.activeBackground': '#262626',
      'editor.selectionHighlightBackground': '#FCA31120',
      'editor.findMatchBackground': '#FCA31140',
      'editor.findMatchHighlightBackground': '#FCA31120',
      'editorBracketMatch.background': '#FCA31130',
      'editorBracketMatch.border': '#FCA311',
      
      // Scrollbar
      'scrollbar.shadow': '#00000050',
      'scrollbarSlider.background': '#52525220',
      'scrollbarSlider.hoverBackground': '#52525230',
      'scrollbarSlider.activeBackground': '#52525240',
      
      // Minimap
      'minimap.background': '#0a0a0a',
      'minimap.selectionHighlight': '#FCA31140',
      
      // Line numbers
      'editorLineNumber.foreground': '#525252',
      'editorLineNumber.activeForeground': '#e5e5e5',
      
      // Gutter
      'editorGutter.background': '#0a0a0a',
      'editorGutter.addedBackground': '#4ade8040',
      'editorGutter.deletedBackground': '#ef444440',
      'editorGutter.modifiedBackground': '#60a5fa40',
      
      // Widgets (autocomplete, hover, etc)
      'editorWidget.background': '#171717',
      'editorWidget.foreground': '#e5e5e5',
      'editorWidget.border': '#262626',
      'editorSuggestWidget.background': '#171717',
      'editorSuggestWidget.foreground': '#e5e5e5',
      'editorSuggestWidget.border': '#262626',
      'editorSuggestWidget.highlightForeground': '#FCA311',
      'editorSuggestWidget.selectedBackground': '#FCA31120',
      
      // Hover
      'editorHoverWidget.background': '#171717',
      'editorHoverWidget.foreground': '#e5e5e5',
      'editorHoverWidget.border': '#262626',
    },
  });

  // Define light theme
  monacoInstance.editor.defineTheme('devdb-light', {
    base: 'vs',
    inherit: true,
    rules: [
      // SQL Keywords
      { token: 'keyword.sql', foreground: 'FCA311', fontStyle: 'bold' },
      { token: 'keyword', foreground: 'FCA311', fontStyle: 'bold' },
      
      // Strings
      { token: 'string.sql', foreground: '16a34a' },
      { token: 'string', foreground: '16a34a' },
      
      // Comments
      { token: 'comment.sql', foreground: '737373', fontStyle: 'italic' },
      { token: 'comment', foreground: '737373', fontStyle: 'italic' },
      
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
      'editor.background': '#FFFFFF',
      'editor.foreground': '#14213D',
      'editor.lineHighlightBackground': '#FAFAFA',
      'editor.selectionBackground': '#FCA31120',
      'editor.inactiveSelectionBackground': '#FCA31110',
      'editorCursor.foreground': '#FCA311',
      'editorWhitespace.foreground': '#73737340',
      'editorIndentGuide.background': '#E5E5E5',
      'editorIndentGuide.activeBackground': '#E5E5E5',
      'editor.selectionHighlightBackground': '#FCA31115',
      'editor.findMatchBackground': '#FCA31130',
      'editor.findMatchHighlightBackground': '#FCA31115',
      'editorBracketMatch.background': '#FCA31120',
      'editorBracketMatch.border': '#FCA311',
      
      // Scrollbar
      'scrollbar.shadow': '#00000010',
      'scrollbarSlider.background': '#73737320',
      'scrollbarSlider.hoverBackground': '#73737330',
      'scrollbarSlider.activeBackground': '#73737340',
      
      // Line numbers
      'editorLineNumber.foreground': '#737373',
      'editorLineNumber.activeForeground': '#14213D',
      
      // Gutter
      'editorGutter.background': '#FFFFFF',
      
      // Widgets
      'editorWidget.background': '#FFFFFF',
      'editorWidget.foreground': '#14213D',
      'editorWidget.border': '#E5E5E5',
      'editorSuggestWidget.background': '#FFFFFF',
      'editorSuggestWidget.foreground': '#14213D',
      'editorSuggestWidget.border': '#E5E5E5',
      'editorSuggestWidget.highlightForeground': '#FCA311',
      'editorSuggestWidget.selectedBackground': '#FCA31115',
      
      // Hover
      'editorHoverWidget.background': '#FFFFFF',
      'editorHoverWidget.foreground': '#14213D',
      'editorHoverWidget.border': '#E5E5E5',
    },
  });
  
  // Set the initial theme
  monacoInstance.editor.setTheme(isDark ? 'devdb-dark' : 'devdb-light');
  
  return monacoInstance;
};

// Export the loader for use in components
export { loader };