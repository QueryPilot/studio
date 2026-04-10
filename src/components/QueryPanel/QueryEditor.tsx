import { logger } from "@/lib/logger";
import {
  memo,
  useCallback,
  forwardRef,
  useEffect,
  useRef,
  type RefObject,
} from "react";
import { SqlEditor } from "@/components/CodeEditor/SqlEditor";
import type { SqlEditorRef } from "@/components/CodeEditor/SqlEditor";
import type { SqlDialect } from "@/components/CodeEditor";
import type { QueryVariable } from "@/lib/queryVariables/types";
import { useDuckDbFileDrop } from "@/hooks/useDuckDbFileDrop";
import { cn } from "@/lib/utils";

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
  /** Whether to auto-focus the editor on mount (default false) */
  autoFocus?: boolean;
  /** Variable values for inline widget display */
  variableValues?: Record<string, QueryVariable>;
  /** Variable scope mode */
  variableScope?: "global" | "per_statement";
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
      autoFocus = false,
      variableValues,
      variableScope,
    },
    ref,
  ) {
    const valueRef = useRef(value);

    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    const { dropZoneRef, isFileDragOver } = useDuckDbFileDrop(
      ref as RefObject<SqlEditorRef | null>,
      dbType,
      { readOnly },
    );

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
      <div
        ref={dropZoneRef}
        className={cn(
          "relative h-full overflow-hidden rounded-md transition-[box-shadow] duration-150",
          isFileDragOver &&
            "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]",
        )}
      >
        {isFileDragOver && (
          <div
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md bg-background/75 text-sm font-medium text-primary backdrop-blur-[2px]"
            aria-live="polite"
          >
            Drop file to query
          </div>
        )}
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
          variableValues={variableValues}
          variableScope={variableScope}
        />
      </div>
    );
  }),
);
