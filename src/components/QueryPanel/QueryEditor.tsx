import { logger } from "@/lib/logger";
import { memo, useCallback, forwardRef, useEffect, useRef } from "react";
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
  onSelectionChange?: (selection: string) => void;
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
  /** Whether to auto-focus the editor on mount (default false) */
  autoFocus?: boolean;
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
      onSelectionChange,
      onExecute,
      isExecuting = false,
      height = "100%",
      readOnly = false,
      dialectOverride,
      onDialectDetected,
      extraBottomPadding = 100,
      autoFocus = false,
    },
    ref,
  ) {
    const valueRef = useRef(value);

    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    const handleExecute = useCallback(
      (query?: string) => {
        logger.debug("query-editor", "Execute requested", {
          hasInlineQuery: Boolean(query),
          inlineQueryLength: query?.length || 0,
          editorValueLength: valueRef.current.length || 0,
        });

        // Prevent execution if already executing
        if (isExecuting) {
          logger.info(
            "[QueryEditor.handleExecute] Already executing, ignoring",
          );
          return;
        }

        if (onExecute) {
          const finalQuery = query || valueRef.current;
          logger.debug("query-editor", "Forwarding execute to callback", {
            finalQueryLength: finalQuery.length || 0,
          });
          onExecute(finalQuery);
        }
      },
      [isExecuting, onExecute],
    );

    return (
      <div className="h-full overflow-hidden">
        <SqlEditor
          ref={ref}
          value={value}
          onChange={onChange}
          onSelectionChange={onSelectionChange}
          onChangeDelay={120}
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
          autoFocus={autoFocus}
          extraBottomPadding={extraBottomPadding}
        />
      </div>
    );
  }),
);
