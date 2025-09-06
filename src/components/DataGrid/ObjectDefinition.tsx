import React, { useEffect, useState, useMemo } from "react";
import { databaseService } from "@/services/databaseService";
import { cn } from "@/lib/utils";
import Editor from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { initMonaco, DatabaseType } from "@/lib/monaco-loader";
import { useConnectionStore } from "@/stores/connectionStore";

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
  const [theme, setTheme] = useState<'devdb-dark' | 'devdb-light'>(() => {
    const isDark = document.documentElement.classList.contains('dark');
    return isDark ? 'devdb-dark' : 'devdb-light';
  });
  const connections = useConnectionStore(state => state.connections);
  
  // Determine database type from connection
  const databaseType = useMemo<DatabaseType>(() => {
    const connection = connections.find(c => c.id === connectionId);
    if (!connection) return 'postgresql';
    
    switch (connection.type) {
      case 'postgresql':
        return 'postgresql';
      case 'mysql':
        return 'mysql';
      case 'mssql':
        return 'sqlserver';
      case 'sqlite':
        return 'sqlite';
      default:
        return 'postgresql';
    }
  }, [connectionId, connections]);

  useEffect(() => {
    initMonaco(databaseType).then(() => {
      const updateTheme = () => {
        const isDark = document.documentElement.classList.contains('dark');
        const newTheme = isDark ? 'devdb-dark' : 'devdb-light';
        monaco.editor.setTheme(newTheme);
        setTheme(newTheme);
      };
      
      // Set initial theme
      updateTheme();
      
      // Watch for theme changes
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            updateTheme();
          }
        });
      });
      
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class']
      });
      
      // Also listen for system theme changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => updateTheme();
      mediaQuery.addEventListener('change', handleChange);
      
      return () => {
        observer.disconnect();
        mediaQuery.removeEventListener('change', handleChange);
      };
    });
  }, [databaseType]);

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
          theme={theme}
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