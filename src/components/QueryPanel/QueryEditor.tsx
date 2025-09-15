import { memo } from "react";
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
  height?: string;
  readOnly?: boolean;
}

export const QueryEditor = memo(function QueryEditor({
  connectionId: _connectionId, // Unused but kept for compatibility
  database: _database, // Unused but kept for compatibility
  schema: _schema, // Unused but kept for compatibility
  dbType = "postgres",
  value = "",
  onChange,
  onExecute,
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

  const handleExecute = () => {
    if (onExecute && value) {
      onExecute(value);
    }
  };

  return (
    <div className="h-full overflow-hidden">
      <CodeEditor
        value={value}
        onChange={onChange}
        onExecute={handleExecute}
        language="sql"
        dialect={dialect}
        connectionId={_connectionId}
        database={_database}
        schema={_schema}
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
