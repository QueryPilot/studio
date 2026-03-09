/**
 * SQL Editor Effects Hook
 *
 * Handles debounced onChange, execute logic, and event bus subscriptions.
 */

import { useRef, useEffect, useCallback, useMemo } from "react";
import type { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";

import { eventBus } from "@/services/eventBus";
import { debounce } from "@/utils/debounce";
import {
  getStatementAtPosition,
  isDestructiveQuery,
} from "../core";
import type { SqlDialect } from "../types";

interface UseSqlEditorEffectsOptions {
  onChange?: (value: string) => void;
  onChangeDelay: number;
  onExecute?: (query: string) => void;
  onGotoDefinition?: (event: {
    type: "table" | "column";
    name: string;
    schema?: string;
    table?: string;
  }) => void;
  confirmDestructiveQuery?: (request: {
    query: string;
    type: string;
    message: string;
  }) => boolean | Promise<boolean>;
  onDialectDetected?: (dialect: SqlDialect) => void;
  detectDialect: ((value: string) => void) & { cancel: () => void };
  viewRef: React.RefObject<EditorView | null>;
}

export function useSqlEditorEffects({
  onChange,
  onChangeDelay,
  onExecute,
  onGotoDefinition,
  confirmDestructiveQuery,
  onDialectDetected,
  detectDialect,
  viewRef,
}: UseSqlEditorEffectsOptions) {
  // Stable refs for callbacks
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);
  const onGotoDefinitionRef = useRef(onGotoDefinition);
  const confirmDestructiveQueryRef = useRef(confirmDestructiveQuery);
  const onDialectDetectedRef = useRef(onDialectDetected);
  const lastEmittedValueRef = useRef<string | null>(null);

  // Keep refs updated
  useEffect(() => {
    onChangeRef.current = onChange;
    onExecuteRef.current = onExecute;
    onGotoDefinitionRef.current = onGotoDefinition;
    confirmDestructiveQueryRef.current = confirmDestructiveQuery;
    onDialectDetectedRef.current = onDialectDetected;
  }, [onChange, onExecute, onGotoDefinition, confirmDestructiveQuery, onDialectDetected]);

  // Create debounced onChange
  const handleChange = useCallback((value: string) => {
    lastEmittedValueRef.current = value;
    onChangeRef.current?.(value);
  }, []);

  /* eslint-disable react-hooks/refs -- ref is read at call-time inside debounced callback, not during render */
  const debouncedOnChange = useMemo(
    () =>
      onChangeDelay > 0
        ? debounce(handleChange, onChangeDelay)
        : handleChange,
    [onChangeDelay, handleChange],
  );
  /* eslint-enable react-hooks/refs */

  // Cleanup debounced functions on unmount
  useEffect(() => {
    return () => {
      detectDialect.cancel();
      if ('cancel' in debouncedOnChange) {
        (debouncedOnChange as { cancel: () => void }).cancel();
      }
    };
  }, [detectDialect, debouncedOnChange]);

  // Execute query with safety check
  const executeQuery = useCallback(async (query: string) => {
    if (!onExecuteRef.current) return;

    const check = isDestructiveQuery(query);
    if (check.isDestructive) {
      const message =
        check.type === "TRUNCATE"
          ? `⚠️ Warning: You are running a TRUNCATE command. This will delete ALL rows in the table. Proceed?`
          : check.type === "DROP"
          ? `⚠️ Warning: You are running a DROP command. This will permanently delete the database object. Proceed?`
            : `⚠️ Warning: You are running a ${check.type} without a WHERE clause. This will affect ALL rows. Proceed?`;

      const confirmed = confirmDestructiveQueryRef.current
        ? await confirmDestructiveQueryRef.current({
            query,
            type: check.type,
            message,
          })
        : window.confirm(message);

      if (!confirmed) {
        return;
      }
    }

    onExecuteRef.current(query);
  }, []);

  // Create execute keymap
  /* eslint-disable react-hooks/refs -- ref is read at call-time inside keymap handler, not during render */
  const executeKeymap = useMemo(() => {
    if (!onExecute) return [];

    return Prec.highest(
      keymap.of([
        {
          key: "Mod-Enter",
          run: (view) => {
            const selection = view.state.selection.main;

            // Priority 1: If text is selected, execute the selection
            if (selection.from !== selection.to) {
              const selectedText = view.state.doc
                .sliceString(selection.from, selection.to)
                .trim();
              if (selectedText) {
                void executeQuery(selectedText);
                return true;
              }
            }

            // Priority 2: Execute statement at cursor
            const statementAtCursor = getStatementAtPosition(
              view.state,
              selection.head,
            );
            if (statementAtCursor) {
              void executeQuery(statementAtCursor.text);
              return true;
            }

            return false;
          },
        },
      ]),
    );
  }, [onExecute, executeQuery]);
  /* eslint-enable react-hooks/refs */

  // Handle external editor events (e.g. from Command Palette)
  // Note: query-editor:execute is handled solely by QueryPanel to avoid duplicate execution.
  useEffect(() => {
    const handleFind = () => {
      if (viewRef.current && viewRef.current.hasFocus) {
        openSearchPanel(viewRef.current);
      }
    };

    const handleReplace = () => {
      if (viewRef.current && viewRef.current.hasFocus) {
        openSearchPanel(viewRef.current);
      }
    };

    eventBus.on("query-editor:find", handleFind);
    eventBus.on("query-editor:replace", handleReplace);

    return () => {
      eventBus.off("query-editor:find", handleFind);
      eventBus.off("query-editor:replace", handleReplace);
    };
  }, [viewRef]);

  return {
    onChangeRef,
    onExecuteRef,
    onGotoDefinitionRef,
    onDialectDetectedRef,
    lastEmittedValueRef,
    debouncedOnChange,
    executeQuery,
    executeKeymap,
  };
}
