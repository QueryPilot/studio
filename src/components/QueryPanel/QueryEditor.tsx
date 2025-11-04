import { memo, useCallback } from "react";
import { CodeEditor } from "@/components/CodeEditor";
import type { SqlDialect } from "@/components/CodeEditor";

interface QueryEditorProps {
  connectionId: string;
  database: string;
  schema?: string;
  dbType?: string;
  value?: string;
  onChange?: (value: string | undefined) => void;
  onExecute?: (query: string) => void;
  isExecuting?: boolean;
  height?: string;
  readOnly?: boolean;
}

export const QueryEditor = memo(function QueryEditor({
  connectionId,
  database,
  schema,
  dbType = "postgres",
  value = "",
  onChange,
  onExecute,
  isExecuting = false,
  height = "100%",
  readOnly = false,
}: QueryEditorProps) {
  // Map dbType to CodeEditor dialect
  const dialect: SqlDialect =
    dbType === "mysql"
      ? "mysql"
      : dbType === "sqlite"
      ? "sqlite"
      : "postgresql";

  const handleExecute = useCallback(
    (query?: string) => {
      console.log('[QueryEditor.handleExecute] Called with:', {
        query,
        queryLength: query?.length || 0,
        value,
        valueLength: value?.length || 0,
        willUse: query || value,
      });

      // Prevent execution if already executing
      if (isExecuting) {
        console.log('[QueryEditor.handleExecute] Already executing, ignoring');
        return;
      }

      if (onExecute) {
        const finalQuery = query || value;
        console.log('[QueryEditor.handleExecute] Calling onExecute with:', {
          finalQuery,
          finalQueryLength: finalQuery?.length || 0,
        });
        onExecute(finalQuery);
      }
    },
    [isExecuting, onExecute, value],
  );

  return (
    <div className="h-full overflow-hidden">
      <CodeEditor
        value={value}
        onChange={onChange}
        onExecute={handleExecute}
        language="sql"
        dialect={dialect}
        connectionId={connectionId}
        database={database}
        schema={schema}
        readOnly={readOnly}
        height={height}
        theme="auto"
        placeholder="Enter your SQL query..."
        autoFocus={true}
        lineNumbers={true}
      />
    </div>
  );
});
