import { logger } from "@/lib/logger";
import { memo, useCallback, forwardRef, useRef, useEffect } from "react";
import { SqlEditor, type SqlEditorRef } from "@/components/CodeEditor/SqlEditor";
import type { SqlDialect } from "@/components/CodeEditor";

export interface QueryEditorRef {
  focus: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
  getSelection: () => string;
  replaceSelection: (text: string) => void;
  revealLine: (line: number) => void;
  getQueryAtCursor: () => string | undefined;
}

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
  /** Enable vim mode */
  vimMode?: boolean;
}

export const QueryEditor = memo(
  forwardRef<QueryEditorRef, QueryEditorProps>(function QueryEditor(
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
      vimMode = false,
    },
    ref,
  ) {
    const editorRef = useRef<SqlEditorRef>(null);
    const isExecutingRef = useRef(isExecuting);
    const valueRef = useRef(value);

    // Keep refs updated
    isExecutingRef.current = isExecuting;
    valueRef.current = value;

    // Expose imperative handle
    useEffect(() => {
      if (typeof ref === "function") {
        ref({
          focus: () => editorRef.current?.focus(),
          getValue: () => editorRef.current?.getValue() || "",
          setValue: (v) => editorRef.current?.setValue(v),
          getSelection: () => editorRef.current?.getSelection() || "",
          replaceSelection: (t) => editorRef.current?.replaceSelection(t),
          revealLine: (l) => editorRef.current?.revealLine(l),
          getQueryAtCursor: () => editorRef.current?.getQueryAtCursor(),
        });
      } else if (ref) {
        ref.current = {
          focus: () => editorRef.current?.focus(),
          getValue: () => editorRef.current?.getValue() || "",
          setValue: (v) => editorRef.current?.setValue(v),
          getSelection: () => editorRef.current?.getSelection() || "",
          replaceSelection: (t) => editorRef.current?.replaceSelection(t),
          revealLine: (l) => editorRef.current?.revealLine(l),
          getQueryAtCursor: () => editorRef.current?.getQueryAtCursor(),
        };
      }
    }, [ref]);

    const handleExecute = useCallback(
      (query: string) => {
        logger.info("[QueryEditor.handleExecute] Called with:", {
          query,
          queryLength: query?.length || 0,
        });

        // Prevent execution if already executing
        if (isExecutingRef.current) {
          logger.info(
            "[QueryEditor.handleExecute] Already executing, ignoring",
          );
          return;
        }

        if (onExecute) {
          const finalQuery = query || valueRef.current;
          logger.info("[QueryEditor.handleExecute] Calling onExecute with:", {
            finalQuery,
            finalQueryLength: finalQuery?.length || 0,
          });
          onExecute(finalQuery);
        }
      },
      [onExecute],
    );

    const handleChange = useCallback(
      (newValue: string) => {
        onChange?.(newValue);
      },
      [onChange],
    );

    return (
      <div className="h-full overflow-hidden">
        <SqlEditor
          ref={editorRef}
          initialValue={value}
          onChange={handleChange}
          onChangeDelay={150} // Debounced updates - reduces re-renders
          onExecute={handleExecute}
          connectionId={connectionId}
          database={database}
          schema={schema}
          dbType={dbType}
          dialectOverride={dialectOverride}
          onDialectDetected={onDialectDetected}
          vimMode={vimMode}
          readOnly={readOnly}
          autoFocus={true}
          height={height}
          placeholder="Enter your SQL query..."
        />
      </div>
    );
  }),
);
