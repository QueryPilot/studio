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
      // Prevent execution if already executing
      if (isExecuting) {
        return;
      }

      if (onExecute) {
        onExecute(query || value);
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
