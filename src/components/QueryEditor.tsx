import { useRef, useState, useEffect } from "react";
import Editor, { Monaco } from "@monaco-editor/react";
import { editor } from "monaco-editor";
import { useConnectionStore } from "@/stores";
import { Button } from "@/components/ui/button";
import { Play, Square, History, Save, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { configureSQLLanguage, registerSQLSnippets } from "./QueryEditor/monacoConfig";
import { defineThemes } from "./QueryEditor/monacoTheme";
import { schemaService } from "@/services/schemaService";

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
  const [isRefreshingSchema, setIsRefreshingSchema] = useState(false);
  const languageDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const snippetsDisposableRef = useRef<{ dispose: () => void } | null>(null);

  const handleEditorDidMount = (
    editor: editor.IStandaloneCodeEditor,
    monaco: Monaco,
  ) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Apply theme after mount
    monaco.editor.setTheme(theme === "dark" ? "devdb-dark" : "devdb-light");

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

    // Register SQL snippets only once during mount
    if (!snippetsDisposableRef.current) {
      snippetsDisposableRef.current = registerSQLSnippets(monaco);
    }
    
    // Initial configuration will be done by useEffect
  };

  // Effect to configure/reconfigure intellisense when connection changes
  useEffect(() => {
    if (monacoRef.current && activeConnectionId) {
      // Dispose previous configuration if exists
      if (languageDisposableRef.current) {
        languageDisposableRef.current.dispose();
        languageDisposableRef.current = null;
      }
      
      // Configure new language features
      languageDisposableRef.current = configureSQLLanguage({ 
        connectionId: activeConnectionId, 
        monaco: monacoRef.current 
      });
      
      // Refresh schema
      schemaService.getSchema(activeConnectionId).catch(err => {
        console.warn('[QueryEditor] Failed to refresh schema:', err);
      });
    }
    
    // Cleanup on unmount or connection change
    return () => {
      if (languageDisposableRef.current) {
        languageDisposableRef.current.dispose();
        languageDisposableRef.current = null;
      }
    };
  }, [activeConnectionId]);

  // Effect to update theme when it changes
  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      monacoRef.current.editor.setTheme(theme === "dark" ? "devdb-dark" : "devdb-light");
    }
  }, [theme]);

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

  const handleRefreshSchema = async () => {
    if (!activeConnectionId) return;
    
    setIsRefreshingSchema(true);
    try {
      // Force refresh schema
      await schemaService.getSchema(activeConnectionId, true);
      
      // Reconfigure language features if Monaco is available
      if (monacoRef.current) {
        // Dispose existing configuration first
        if (languageDisposableRef.current) {
          languageDisposableRef.current.dispose();
        }
        
        // Configure new language features
        languageDisposableRef.current = configureSQLLanguage({ 
          connectionId: activeConnectionId, 
          monaco: monacoRef.current 
        });
      }
    } catch (error) {
      console.error('[QueryEditor] Failed to refresh schema:', error);
    } finally {
      setIsRefreshingSchema(false);
    }
  };

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      // Cleanup language features
      if (languageDisposableRef.current) {
        languageDisposableRef.current.dispose();
      }
      // Cleanup snippets
      if (snippetsDisposableRef.current) {
        snippetsDisposableRef.current.dispose();
      }
    };
  }, []);

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
          theme={theme === "dark" ? "devdb-dark" : "devdb-light"}
          loading={<div className="h-full w-full bg-background" />}
          beforeMount={(monaco) => {
            // Define themes before mount
            defineThemes(monaco);
          }}
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
            onClick={handleRefreshSchema}
            disabled={!activeConnection || isRefreshingSchema}
            title="Refresh Schema (for autocomplete)"
          >
            <RefreshCw className={cn("h-3 w-3", isRefreshingSchema && "animate-spin")} />
          </Button>

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
