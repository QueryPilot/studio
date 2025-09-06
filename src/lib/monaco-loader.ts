import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { registerEnhancedSQLLanguage, DatabaseType } from './monaco-sql-config';

// Configure the Monaco loader to use the local Monaco instance
loader.config({ monaco });

// Initialize and get Monaco instance
export const initMonaco = async (databaseType: DatabaseType = 'postgresql') => {
  const monacoInstance = await loader.init();
  
  // Register enhanced SQL language configuration for the specific database
  registerEnhancedSQLLanguage(databaseType);
  
  // Define our custom themes immediately when Monaco loads
  const isDark = document.documentElement.classList.contains('dark');
  
  // Define DevDB Dark Theme - Inherits from vs-dark for comprehensive coverage
  monacoInstance.editor.defineTheme('devdb-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      // SQL Keywords - Primary brand color for prominence
      { token: 'keyword.sql', foreground: 'FCA311', fontStyle: 'bold' },
      { token: 'keyword', foreground: 'FCA311', fontStyle: 'bold' },
      
      // Data Types - Distinct color for type recognition
      { token: 'type.sql', foreground: '67e8f9' },
      { token: 'type', foreground: '67e8f9' },
      
      // Built-in Functions - Purple for clear distinction
      { token: 'predefined.sql', foreground: 'c084fc', fontStyle: 'bold' },
      { token: 'function.sql', foreground: 'c084fc' },
      { token: 'support.function.sql', foreground: 'c084fc' },
      
      // Strings - Green for excellent visibility
      { token: 'string.sql', foreground: '4ade80' },
      { token: 'string', foreground: '4ade80' },
      { token: 'string.quoted.single.sql', foreground: '4ade80' },
      { token: 'string.quoted.double.sql', foreground: '4ade80' },
      { token: 'string.quoted.backtick.sql', foreground: '4ade80' },
      
      // Numbers - Light blue for numeric clarity
      { token: 'number.sql', foreground: '60a5fa' },
      { token: 'number', foreground: '60a5fa' },
      { token: 'constant.numeric.sql', foreground: '60a5fa' },
      
      // Comments - Muted for less distraction
      { token: 'comment.sql', foreground: '6b7280', fontStyle: 'italic' },
      { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
      { token: 'comment.line.sql', foreground: '6b7280', fontStyle: 'italic' },
      { token: 'comment.block.sql', foreground: '6b7280', fontStyle: 'italic' },
      
      // Operators & Delimiters
      { token: 'operator.sql', foreground: 'd4d4d8' },
      { token: 'operator', foreground: 'd4d4d8' },
      { token: 'delimiter.sql', foreground: 'd4d4d8' },
      { token: 'delimiter', foreground: 'd4d4d8' },
      
      // Identifiers (tables, columns, aliases)
      { token: 'identifier.sql', foreground: 'd4d4d4' },
      { token: 'identifier', foreground: 'd4d4d4' },
      { token: 'identifier.quoted.sql', foreground: 'a78bfa' }, // Purple for quoted identifiers
      { token: 'variable.sql', foreground: 'fbbf24' },
      { token: 'variable', foreground: 'fbbf24' },
      
      // Schema/Database qualified names
      { token: 'entity.name.schema.sql', foreground: '93c5fd' },
      { token: 'entity.name.table.sql', foreground: '67e8f9' },
      { token: 'entity.name.column.sql', foreground: 'e5e5e5' },
      
      // Special tokens
      { token: 'constant.language.sql', foreground: 'f472b6' },
      { token: 'constant.language.null.sql', foreground: 'f472b6' },
      { token: 'constant.language.boolean.sql', foreground: 'f472b6' },
      
      // Database-specific extensions
      { token: 'storage.type.sql', foreground: '67e8f9' },
      { token: 'support.type.sql', foreground: '67e8f9' },
      { token: 'entity.name.type.sql', foreground: '67e8f9' },
    ],
    colors: {
      // Editor core
      'editor.background': '#0a0a0a',
      'editor.foreground': '#d4d4d4',
      'editor.lineHighlightBackground': '#171717',
      'editor.lineHighlightBorder': '#262626',
      
      // Selection
      'editor.selectionBackground': '#FCA31135',
      'editor.inactiveSelectionBackground': '#FCA31120',
      'editor.selectionHighlightBackground': '#FCA31118',
      'editor.selectionHighlightBorder': '#FCA31140',
      
      // Find matches
      'editor.findMatchBackground': '#FCA31140',
      'editor.findMatchHighlightBackground': '#FCA31120',
      'editor.findRangeHighlightBackground': '#FCA31110',
      
      // Word highlights
      'editor.wordHighlightBackground': '#FCA31115',
      'editor.wordHighlightStrongBackground': '#FCA31125',
      
      // Cursor & brackets
      'editorCursor.foreground': '#FCA311',
      'editorCursor.background': '#0a0a0a',
      'editorBracketMatch.background': '#FCA31130',
      'editorBracketMatch.border': '#FCA31180',
      
      // Whitespace & guides
      'editorWhitespace.foreground': '#52525240',
      'editorIndentGuide.background': '#262626',
      'editorIndentGuide.activeBackground': '#404040',
      'editorRuler.foreground': '#262626',
      
      // Line numbers & gutter
      'editorLineNumber.foreground': '#525252',
      'editorLineNumber.activeForeground': '#a3a3a3',
      'editorGutter.background': '#0a0a0a',
      'editorGutter.addedBackground': '#4ade8040',
      'editorGutter.deletedBackground': '#ef444440',
      'editorGutter.modifiedBackground': '#60a5fa40',
      
      // Scrollbar
      'scrollbar.shadow': '#00000050',
      'scrollbarSlider.background': '#52525220',
      'scrollbarSlider.hoverBackground': '#52525230',
      'scrollbarSlider.activeBackground': '#52525240',
      
      // Minimap
      'minimap.background': '#0a0a0a',
      'minimap.selectionHighlight': '#FCA31140',
      'minimap.findMatchHighlight': '#FCA31160',
      'minimapGutter.addedBackground': '#4ade8060',
      'minimapGutter.deletedBackground': '#ef444460',
      'minimapGutter.modifiedBackground': '#60a5fa60',
      
      // Widgets (autocomplete, hover, etc)
      'editorWidget.background': '#171717',
      'editorWidget.foreground': '#d4d4d4',
      'editorWidget.border': '#262626',
      'editorWidget.resizeBorder': '#FCA31140',
      
      // Suggest widget
      'editorSuggestWidget.background': '#171717',
      'editorSuggestWidget.foreground': '#d4d4d4',
      'editorSuggestWidget.border': '#262626',
      'editorSuggestWidget.highlightForeground': '#FCA311',
      'editorSuggestWidget.selectedBackground': '#FCA31120',
      'editorSuggestWidget.focusHighlightForeground': '#FCA311',
      'editorSuggestWidget.selectedForeground': '#ffffff',
      'editorSuggestWidget.selectedIconForeground': '#FCA311',
      
      // Hover widget
      'editorHoverWidget.background': '#171717',
      'editorHoverWidget.foreground': '#d4d4d4',
      'editorHoverWidget.border': '#262626',
      'editorHoverWidget.statusBarBackground': '#1f1f1f',
      
      // Peek view
      'peekView.border': '#FCA311',
      'peekViewEditor.background': '#0f0f0f',
      'peekViewEditor.matchHighlightBackground': '#FCA31130',
      'peekViewResult.background': '#171717',
      'peekViewResult.fileForeground': '#d4d4d4',
      'peekViewResult.lineForeground': '#a3a3a3',
      'peekViewResult.matchHighlightBackground': '#FCA31130',
      'peekViewResult.selectionBackground': '#FCA31125',
      'peekViewTitle.background': '#171717',
      'peekViewTitleDescription.foreground': '#a3a3a3',
      'peekViewTitleLabel.foreground': '#d4d4d4',
    },
  });

  // Define DevDB Light Theme - Inherits from vs for comprehensive coverage
  monacoInstance.editor.defineTheme('devdb-light', {
    base: 'vs',
    inherit: true,
    rules: [
      // SQL Keywords - Primary brand color
      { token: 'keyword.sql', foreground: 'EA9E00', fontStyle: 'bold' },
      { token: 'keyword', foreground: 'EA9E00', fontStyle: 'bold' },
      
      // Data Types - Navy blue for types
      { token: 'type.sql', foreground: '0891b2' },
      { token: 'type', foreground: '0891b2' },
      
      // Built-in Functions - Purple for distinction
      { token: 'predefined.sql', foreground: '9333ea', fontStyle: 'bold' },
      { token: 'function.sql', foreground: '9333ea' },
      { token: 'support.function.sql', foreground: '9333ea' },
      
      // Strings - Green for readability
      { token: 'string.sql', foreground: '16a34a' },
      { token: 'string', foreground: '16a34a' },
      { token: 'string.quoted.single.sql', foreground: '16a34a' },
      { token: 'string.quoted.double.sql', foreground: '16a34a' },
      { token: 'string.quoted.backtick.sql', foreground: '16a34a' },
      
      // Numbers - Blue for clarity
      { token: 'number.sql', foreground: '2563eb' },
      { token: 'number', foreground: '2563eb' },
      { token: 'constant.numeric.sql', foreground: '2563eb' },
      
      // Comments - Gray italic
      { token: 'comment.sql', foreground: '737373', fontStyle: 'italic' },
      { token: 'comment', foreground: '737373', fontStyle: 'italic' },
      { token: 'comment.line.sql', foreground: '737373', fontStyle: 'italic' },
      { token: 'comment.block.sql', foreground: '737373', fontStyle: 'italic' },
      
      // Operators & Delimiters
      { token: 'operator.sql', foreground: '525252' },
      { token: 'operator', foreground: '525252' },
      { token: 'delimiter.sql', foreground: '525252' },
      { token: 'delimiter', foreground: '525252' },
      
      // Identifiers - Dark navy from brand
      { token: 'identifier.sql', foreground: '14213D' },
      { token: 'identifier', foreground: '14213D' },
      { token: 'identifier.quoted.sql', foreground: '7c3aed' }, // Purple for quoted identifiers
      { token: 'variable.sql', foreground: 'd97706' },
      { token: 'variable', foreground: 'd97706' },
      
      // Schema/Database qualified names
      { token: 'entity.name.schema.sql', foreground: '6366f1' },
      { token: 'entity.name.table.sql', foreground: '0891b2' },
      { token: 'entity.name.column.sql', foreground: '14213D' },
      
      // Special tokens
      { token: 'constant.language.sql', foreground: 'ec4899' },
      { token: 'constant.language.null.sql', foreground: 'ec4899' },
      { token: 'constant.language.boolean.sql', foreground: 'ec4899' },
      
      // Database-specific extensions
      { token: 'storage.type.sql', foreground: '0891b2' },
      { token: 'support.type.sql', foreground: '0891b2' },
      { token: 'entity.name.type.sql', foreground: '0891b2' },
    ],
    colors: {
      // Editor core
      'editor.background': '#FFFFFF',
      'editor.foreground': '#14213D',
      'editor.lineHighlightBackground': '#FCA31108',
      'editor.lineHighlightBorder': '#FCA31115',
      
      // Selection
      'editor.selectionBackground': '#FCA31125',
      'editor.inactiveSelectionBackground': '#FCA31115',
      'editor.selectionHighlightBackground': '#FCA31112',
      'editor.selectionHighlightBorder': '#FCA31130',
      
      // Find matches
      'editor.findMatchBackground': '#FCA31130',
      'editor.findMatchHighlightBackground': '#FCA31115',
      'editor.findRangeHighlightBackground': '#FCA31108',
      
      // Word highlights
      'editor.wordHighlightBackground': '#FCA31110',
      'editor.wordHighlightStrongBackground': '#FCA31120',
      
      // Cursor & brackets
      'editorCursor.foreground': '#FCA311',
      'editorCursor.background': '#FFFFFF',
      'editorBracketMatch.background': '#FCA31120',
      'editorBracketMatch.border': '#FCA31170',
      
      // Whitespace & guides
      'editorWhitespace.foreground': '#73737340',
      'editorIndentGuide.background': '#E5E5E5',
      'editorIndentGuide.activeBackground': '#d4d4d4',
      'editorRuler.foreground': '#E5E5E5',
      
      // Line numbers & gutter
      'editorLineNumber.foreground': '#737373',
      'editorLineNumber.activeForeground': '#14213D',
      'editorGutter.background': '#FFFFFF',
      'editorGutter.addedBackground': '#4ade8030',
      'editorGutter.deletedBackground': '#ef444430',
      'editorGutter.modifiedBackground': '#60a5fa30',
      
      // Scrollbar
      'scrollbar.shadow': '#00000010',
      'scrollbarSlider.background': '#73737320',
      'scrollbarSlider.hoverBackground': '#73737330',
      'scrollbarSlider.activeBackground': '#73737340',
      
      // Minimap
      'minimap.background': '#FFFFFF',
      'minimap.selectionHighlight': '#FCA31130',
      'minimap.findMatchHighlight': '#FCA31150',
      'minimapGutter.addedBackground': '#4ade8050',
      'minimapGutter.deletedBackground': '#ef444450',
      'minimapGutter.modifiedBackground': '#60a5fa50',
      
      // Widgets
      'editorWidget.background': '#FFFFFF',
      'editorWidget.foreground': '#14213D',
      'editorWidget.border': '#E5E5E5',
      'editorWidget.resizeBorder': '#FCA31130',
      
      // Suggest widget
      'editorSuggestWidget.background': '#FFFFFF',
      'editorSuggestWidget.foreground': '#14213D',
      'editorSuggestWidget.border': '#E5E5E5',
      'editorSuggestWidget.highlightForeground': '#FCA311',
      'editorSuggestWidget.selectedBackground': '#FCA31115',
      'editorSuggestWidget.focusHighlightForeground': '#FCA311',
      'editorSuggestWidget.selectedForeground': '#14213D',
      'editorSuggestWidget.selectedIconForeground': '#FCA311',
      
      // Hover widget
      'editorHoverWidget.background': '#FFFFFF',
      'editorHoverWidget.foreground': '#14213D',
      'editorHoverWidget.border': '#E5E5E5',
      'editorHoverWidget.statusBarBackground': '#FAFAFA',
      
      // Peek view
      'peekView.border': '#FCA311',
      'peekViewEditor.background': '#FAFAFA',
      'peekViewEditor.matchHighlightBackground': '#FCA31125',
      'peekViewResult.background': '#FFFFFF',
      'peekViewResult.fileForeground': '#14213D',
      'peekViewResult.lineForeground': '#737373',
      'peekViewResult.matchHighlightBackground': '#FCA31125',
      'peekViewResult.selectionBackground': '#FCA31120',
      'peekViewTitle.background': '#FFFFFF',
      'peekViewTitleDescription.foreground': '#737373',
      'peekViewTitleLabel.foreground': '#14213D',
    },
  });
  
  // Set the initial theme
  monacoInstance.editor.setTheme(isDark ? 'devdb-dark' : 'devdb-light');
  
  return monacoInstance;
};

// Export the loader for use in components
export { loader };
export type { DatabaseType };