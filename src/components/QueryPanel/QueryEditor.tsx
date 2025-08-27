import { useEffect, useRef, memo, Suspense } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
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
  height = '400px',
  readOnly = false,
}: QueryEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const completionProviderRef = useRef<SQLCompletionProvider | null>(null);
  const disposablesRef = useRef<monaco.IDisposable[]>([]);
  const themeCleanupRef = useRef<(() => void) | null>(null);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Initialize theme
    const themeProvider = MonacoThemeProvider.getInstance();
    themeCleanupRef.current = themeProvider.initTheme();

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
      disposablesRef.current.forEach(d => d.dispose());
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
    wordBasedSuggestions: false,
    suggestSelection: 'first',
    tabCompletion: 'on',
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
    <div className="w-full h-full bg-background">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full">
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
          onMount={handleEditorDidMount}
          options={editorOptions}
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