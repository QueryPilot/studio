import { logger } from "@/lib/logger";
import { memo, useCallback, forwardRef, useMemo, useEffect } from "react";
import { CodeEditor } from "@/components/CodeEditor";
import type { SqlDialect, CodeEditorRef } from "@/components/CodeEditor";
import { detectSqlDialect } from "@/utils/dialectDetector";

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
  /** Override dialect (bypasses auto-detection when set) */
  dialectOverride?: SqlDialect;
  /** Callback to report the detected dialect */
  onDialectDetected?: (dialect: SqlDialect) => void;
}

export const QueryEditor = memo(
  forwardRef<CodeEditorRef, QueryEditorProps>(function QueryEditor(
    {
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
      dialectOverride,
      onDialectDetected,
    },
    ref,
  ) {
    // Smart dialect detection - uses plsql for PL/pgSQL code (DO blocks, functions, etc.)
    const detectedDialect = useMemo<SqlDialect>(() => {
      const detected = detectSqlDialect(dbType, value);
      // Debug logging - remove after fixing
      if (value && value.length > 10) {
        console.log('[QueryEditor] Dialect detection:', {
          dbType,
          valuePreview: value.substring(0, 100),
          detected,
        });
      }
      return detected;
    }, [dbType, value]);

    // Use override if provided, otherwise use detected
    const dialect = dialectOverride ?? detectedDialect;

    // Report detected dialect to parent (for showing in toolbar)
    useEffect(() => {
      onDialectDetected?.(detectedDialect);
    }, [detectedDialect, onDialectDetected]);

    const handleExecute = useCallback(
      (query?: string) => {
        logger.info("[QueryEditor.handleExecute] Called with:", {
          query,
          queryLength: query?.length || 0,
          value,
          valueLength: value?.length || 0,
          willUse: query || value,
        });

        // Prevent execution if already executing
        if (isExecuting) {
          logger.info(
            "[QueryEditor.handleExecute] Already executing, ignoring",
          );
          return;
        }

        if (onExecute) {
          const finalQuery = query || value;
          logger.info("[QueryEditor.handleExecute] Calling onExecute with:", {
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
          ref={ref}
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
  }),
);
