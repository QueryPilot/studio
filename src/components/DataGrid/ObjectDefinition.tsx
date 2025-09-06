import React, { useEffect, useState } from "react";
import { databaseService } from "@/services/databaseService";
import { cn } from "@/lib/utils";
import Editor from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { initMonaco } from "@/lib/monaco-loader";

interface ObjectDefinitionProps {
  connectionId: string;
  database: string;
  schema: string;
  objectName: string;
  objectType: "table" | "view" | "materialized_view" | "function" | "procedure";
  className?: string;
  onDefinitionLoad?: (definition: string) => void;
}

export const ObjectDefinition: React.FC<ObjectDefinitionProps> = React.memo(({
  connectionId,
  database,
  schema,
  objectName,
  objectType,
  className,
  onDefinitionLoad,
}) => {
  const [definition, setDefinition] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initMonaco().then(() => {
      const isDark = document.documentElement.classList.contains('dark') || 
                     window.matchMedia('(prefers-color-scheme: dark)').matches;
      monaco.editor.setTheme(isDark ? 'devdb-dark' : 'devdb-light');
    });
  }, []);

  useEffect(() => {
    const fetchDefinition = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const def = await databaseService.getObjectDefinition(
          connectionId,
          database,
          schema,
          objectName,
          objectType
        );
        
        setDefinition(def);
        onDefinitionLoad?.(def);
      } catch (err) {
        console.error("Failed to fetch object definition:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch definition");
      } finally {
        setLoading(false);
      }
    };

    void fetchDefinition();
  }, [connectionId, database, schema, objectName, objectType]); // Remove onDefinitionLoad from deps to prevent re-fetching

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <div className="text-muted-foreground">Loading definition...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className={cn("h-full overflow-hidden", className)}>
      <Editor
          value={definition}
          language="sql"
          theme={document.documentElement.classList.contains('dark') ? 'devdb-dark' : 'devdb-light'}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 12,
            lineHeight: 16,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'monospace'",
            lineNumbers: 'on',
            lineNumbersMinChars: 3,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            wrappingIndent: 'indent',
            automaticLayout: true,
            padding: { top: 8, bottom: 8 },
            renderLineHighlight: 'none',
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
            },
          }}
      />
    </div>
  );
});