import '@/lib/monaco-config'; // Import first to override clipboard before Monaco loads
import { useEffect, useRef, memo, Suspense, useLayoutEffect } from 'react';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { initMonaco } from '@/lib/monaco-loader';
import { SQLCompletionProvider } from './SQLCompletionProvider';
import { MonacoThemeProvider } from './ThemeProvider';
import { Loader2 } from 'lucide-react';
import '@/lib/monaco-workers';

interface QueryEditorProps {
  connectionId: string;
  database: string;
  schema?: string;
  dbType?: string;
  value?: string;
  onChange?: (value: string | undefined) => void;
  onExecute?: (query: string) => void;
  height?: string;
  readOnly?: boolean;
}

export const QueryEditor = memo(function QueryEditor({
  connectionId,
  database,
  schema = 'public',
  dbType = 'postgres',
  value,
  onChange,
  onExecute,
  readOnly = false,
}: QueryEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const completionProviderRef = useRef<SQLCompletionProvider | null>(null);
  const disposablesRef = useRef<monaco.IDisposable[]>([]);
  const themeCleanupRef = useRef<(() => void) | null>(null);

  // Initialize Monaco and themes before editor mounts
  useLayoutEffect(() => {
    initMonaco().then(() => {
      // Monaco is now initialized with themes
      const isDark = document.documentElement.classList.contains('dark');
      monaco.editor.setTheme(isDark ? 'devdb-dark' : 'devdb-light');
    });
  }, []);

  const handleEditorWillMount: BeforeMount = async (monaco) => {
    // Ensure Monaco is initialized with our themes
    await initMonaco();
    const isDark = document.documentElement.classList.contains('dark');
    monaco.editor.setTheme(isDark ? 'devdb-dark' : 'devdb-light');
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Initialize theme - Force immediate application
    const themeProvider = MonacoThemeProvider.getInstance();
    themeCleanupRef.current = themeProvider.initTheme();
    
    // Force refresh theme on mount
    setTimeout(() => {
      const isDark = document.documentElement.classList.contains('dark');
      themeProvider.applyTheme(isDark);
    }, 0);

    // Create and register completion provider
    completionProviderRef.current = new SQLCompletionProvider(
      connectionId,
      database,
      schema,
      dbType
    );

    const completionDisposable = monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: (model, position, context, token) => {
        if (completionProviderRef.current) {
          return completionProviderRef.current.provideCompletionItems(
            model,
            position,
            context,
            token
          );
        }
        return { suggestions: [] };
      },
      triggerCharacters: ['.', ' ', '(', ','],
    });

    disposablesRef.current.push(completionDisposable);

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const currentValue = editor.getValue();
      if (currentValue && onExecute) {
        onExecute(currentValue);
      }
    });

    // Format on paste
    editor.onDidPaste(() => {
      editor.getAction('editor.action.formatDocument')?.run();
    });

    // Configure SQL language defaults
    monaco.languages.setLanguageConfiguration('sql', {
      comments: {
        lineComment: '--',
        blockComment: ['/*', '*/'],
      },
      brackets: [
        ['[', ']'],
        ['(', ')'],
      ],
      autoClosingPairs: [
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: "'", close: "'" },
        { open: '"', close: '"' },
      ],
      surroundingPairs: [
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: "'", close: "'" },
        { open: '"', close: '"' },
      ],
    });
  };

  // Update completion provider when connection info changes
  useEffect(() => {
    if (completionProviderRef.current) {
      completionProviderRef.current.updateConnectionInfo(
        connectionId,
        database,
        schema,
        dbType
      );
    }
  }, [connectionId, database, schema, dbType]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disposablesRef.current.forEach(d => { d.dispose(); });
      if (themeCleanupRef.current) {
        themeCleanupRef.current();
      }
    };
  }, []);

  const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
    fontLigatures: true,
    lineNumbers: 'on',
    renderLineHighlight: 'all',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    suggestOnTriggerCharacters: true,
    quickSuggestions: {
      other: true,
      comments: false,
      strings: false,
    },
    parameterHints: {
      enabled: true,
    },
    wordBasedSuggestions: 'off',
    suggestSelection: 'first',
    tabCompletion: 'on',
    copyWithSyntaxHighlighting: false,
    suggest: {
      filterGraceful: true,
      snippetsPreventQuickSuggestions: false,
      showKeywords: true,
      showSnippets: false,
    },
    readOnly,
    wordWrap: 'on',
    wrappingStrategy: 'advanced',
    scrollbar: {
      vertical: 'auto',
      horizontal: 'auto',
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
    },
    padding: {
      top: 8,
      bottom: 8,
    },
  };

  return (
    <div className="w-full h-full bg-background" style={{ backgroundColor: 'transparent' }}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full bg-background">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Editor
          height="100%"
          defaultLanguage="sql"
          language="sql"
          value={value}
          onChange={onChange}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorDidMount}
          options={editorOptions}
          theme={document.documentElement.classList.contains('dark') ? "devdb-dark" : "devdb-light"}
          loading={
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
        />
      </Suspense>
    </div>
  );
});