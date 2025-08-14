import { useRef, useState, useEffect } from "react";
import Editor, { Monaco } from "@monaco-editor/react";
import { editor } from "monaco-editor";
import { useConnectionStore } from "@/stores";
import { Button } from "@/components/ui/button";
import { Play, Square, History, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

interface QueryEditorProps {
  className?: string;
  onExecute?: (query: string) => void;
  initialValue?: string;
}

export function QueryEditor({
  className,
  onExecute,
  initialValue = "",
}: QueryEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const { activeConnectionId, connections } = useConnectionStore();
  const activeConnection = Array.from(connections.values()).find(
    (c) => c.config.id === activeConnectionId,
  );
  const { theme } = useTheme();
  const [isExecuting, setIsExecuting] = useState(false);
  const [selectedText, setSelectedText] = useState("");

  const handleEditorDidMount = (
    editor: editor.IStandaloneCodeEditor,
    monaco: Monaco,
  ) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Register custom actions
    editor.addAction({
      id: "run-query",
      label: "Run Query",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      contextMenuGroupId: "execution",
      contextMenuOrder: 1,
      run: () => handleExecute(),
    });

    editor.addAction({
      id: "run-selected",
      label: "Run Selected",
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      ],
      contextMenuGroupId: "execution",
      contextMenuOrder: 2,
      run: () => handleExecuteSelected(),
    });

    // Track selection changes
    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        const text = editor.getModel()?.getValueInRange(selection);
        setSelectedText(text || "");
      } else {
        setSelectedText("");
      }
    });

    // Configure SQL language features
    configureSQLFeatures(monaco);
  };

  const configureSQLFeatures = (monaco: Monaco) => {
    // Register completion provider for SQL
    monaco.languages.registerCompletionItemProvider("sql", {
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        // Basic SQL keywords
        const keywords = [
          "SELECT",
          "FROM",
          "WHERE",
          "JOIN",
          "LEFT",
          "RIGHT",
          "INNER",
          "OUTER",
          "INSERT",
          "UPDATE",
          "DELETE",
          "CREATE",
          "ALTER",
          "DROP",
          "TABLE",
          "INDEX",
          "VIEW",
          "TRIGGER",
          "PROCEDURE",
          "FUNCTION",
          "AS",
          "ON",
          "GROUP",
          "BY",
          "ORDER",
          "HAVING",
          "LIMIT",
          "OFFSET",
          "UNION",
          "DISTINCT",
          "VALUES",
          "INTO",
          "SET",
          "AND",
          "OR",
          "NOT",
          "IN",
          "EXISTS",
          "BETWEEN",
          "LIKE",
          "IS",
          "NULL",
          "TRUE",
          "FALSE",
          "CASE",
          "WHEN",
          "THEN",
          "ELSE",
          "END",
          "WITH",
          "RECURSIVE",
        ];

        const suggestions = keywords.map((keyword) => ({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          range: range,
        }));

        // Add common functions
        const functions = [
          "COUNT",
          "SUM",
          "AVG",
          "MIN",
          "MAX",
          "ROUND",
          "FLOOR",
          "CEIL",
          "CONCAT",
          "SUBSTRING",
          "LENGTH",
          "UPPER",
          "LOWER",
          "TRIM",
          "NOW",
          "CURRENT_DATE",
          "CURRENT_TIME",
          "DATE_FORMAT",
        ];

        functions.forEach((func) => {
          suggestions.push({
            label: func,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: `${func}()`,
            range: range,
          });
        });

        return { suggestions };
      },
    });
  };

  const handleExecute = async () => {
    if (!editorRef.current || !onExecute) return;

    const query = editorRef.current.getValue();
    if (!query.trim()) return;

    setIsExecuting(true);
    try {
      await onExecute(query);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleExecuteSelected = async () => {
    if (!selectedText.trim() || !onExecute) return;

    setIsExecuting(true);
    try {
      await onExecute(selectedText);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleStop = () => {
    // TODO: Implement query cancellation
    setIsExecuting(false);
  };

  // Prevent Cmd+A from selecting all text when editor is not focused
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if Cmd+A (Mac) or Ctrl+A (Windows/Linux) is pressed
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        // Check if the Monaco editor is focused
        if (editorRef.current && !editorRef.current.hasTextFocus()) {
          // Prevent default select all behavior
          e.preventDefault();
          // Focus the editor and select all text in the editor instead
          editorRef.current.focus();
          const model = editorRef.current.getModel();
          if (model) {
            const range = model.getFullModelRange();
            editorRef.current.setSelection(range);
          }
        }
      }
    };

    // Add event listener
    document.addEventListener("keydown", handleKeyDown);

    // Cleanup
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Editor */}
      <div className="flex-1 min-h-0 w-full">
        <Editor
          defaultLanguage="sql"
          defaultValue={initialValue}
          theme={theme === "dark" ? "vs-dark" : "vs"}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "on",
            lineNumbersMinChars: 4,
            lineDecorationsWidth: 5,
            glyphMargin: false,
            folding: false,
            renderLineHighlight: "all",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            formatOnPaste: true,
            formatOnType: true,
            suggestOnTriggerCharacters: true,
            wordWrap: "on",
            quickSuggestions: {
              other: true,
              comments: false,
              strings: false,
            },
            parameterHints: {
              enabled: true,
            },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: {
              vertical: "visible",
              horizontal: "visible",
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
            overviewRulerBorder: false,
          }}
        />
      </div>

      {/* Compact Toolbar at Bottom */}
      <div className="flex items-center justify-end h-8 px-2 border-t bg-muted/30">
        {/* Action buttons on right */}
        <div className="flex items-center gap-1">
          {selectedText && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExecuteSelected}
              disabled={!activeConnection || isExecuting}
              className="h-6 px-2 text-xs gap-1"
            >
              <Play className="h-3 w-3" />
              Run Selected
            </Button>
          )}

          {isExecuting ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleStop}
              className="h-6 px-2 text-xs gap-1 text-destructive"
            >
              <Square className="h-3 w-3" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExecute}
              disabled={!activeConnection}
              className="h-6 px-2 text-xs gap-1"
              title="Cmd+Enter"
            >
              <Play className="h-3 w-3" />
              Run
            </Button>
          )}

          <div className="w-px h-4 bg-border mx-1" />

          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            title="Query History"
          >
            <History className="h-3 w-3" />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            title="Save Query"
          >
            <Save className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
