import { logger } from "@/lib/logger";
import { memo, useCallback, forwardRef } from "react";
import { SqlEditor } from "@/components/CodeEditor/SqlEditor";
import type { SqlEditorRef } from "@/components/CodeEditor/SqlEditor";
import type { SqlDialect } from "@/components/CodeEditor";

interface QueryEditorProps {
  connectionId: string;
  database: string;
  schema?: string;
  dbType?: string;
  value?: string;
  onChange?: (value: string) => void;
  onExecute?: (query: string) => void;
  isExecuting?: boolean;
  height?: string;
  readOnly?: boolean;
  /** Override dialect (bypasses auto-detection when set) */
  dialectOverride?: SqlDialect;
  /** Callback to report the detected dialect */
  onDialectDetected?: (dialect: SqlDialect) => void;
  /** Extra bottom padding in pixels for scrolling past end */
  extraBottomPadding?: number;
}

export const QueryEditor = memo(
  forwardRef<SqlEditorRef, QueryEditorProps>(function QueryEditor(
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
      extraBottomPadding = 100,
    },
    ref,
  ) {
    const handleExecute = useCallback(
      (query?: string) => {
        logger.info("[QueryEditor.handleExecute] Called with:", {
          query,
          queryLength: query?.length || 0,
          value,
          valueLength: value.length || 0,
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
            finalQueryLength: finalQuery.length || 0,
          });
          onExecute(finalQuery);
        }
      },
      [isExecuting, onExecute, value],
    );

    return (
      <div className="h-full overflow-hidden">
        <SqlEditor
          ref={ref}
          value={value}
          onChange={onChange}
          onExecute={handleExecute}
          dialectOverride={dialectOverride}
          onDialectDetected={onDialectDetected}
          connectionId={connectionId}
          database={database}
          schema={schema}
          dbType={dbType}
          readOnly={readOnly}
          height={height}
          placeholder="Enter your SQL query..."
          autoFocus={true}
          extraBottomPadding={extraBottomPadding}
        />
      </div>
    );
  }),
);
