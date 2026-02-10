/**
 * SQL Editor Compartments Hook
 *
 * Handles the 5 dynamic reconfiguration useEffects for CodeMirror compartments.
 */

import { useEffect, useRef, useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import {
  EditorView as EditorViewClass,
  placeholder as placeholderExt,
} from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { getThemeExtensions } from "../themes";
import { createDialectLinter } from "../languages/sql/linter-strategy";
import type { EditorCompartments } from "./useSqlEditorSetup";
import type { SqlDialect } from "../types";

interface UseSqlEditorCompartmentsOptions {
  viewRef: React.RefObject<EditorView | null>;
  compartments: EditorCompartments;
  resolvedTheme: string | undefined;
  effectiveDialect: SqlDialect;
  dialectExtensions: Extension[];
  completionExtension: Extension;
  readOnly: boolean;
  placeholder: string;
  connectionId: string;
  schema?: string;
}

export function useSqlEditorCompartments({
  viewRef,
  compartments,
  resolvedTheme,
  effectiveDialect,
  dialectExtensions,
  completionExtension,
  readOnly,
  placeholder,
  connectionId,
  schema,
}: UseSqlEditorCompartmentsOptions) {
  // Track pending reconfigurations for unfocused editors (keyed by compartment name)
  // Using a Map ensures only the latest reconfiguration per compartment is applied on focus
  const pendingRef = useRef<Map<string, () => void>>(new Map());

  // Flush pending reconfigurations when editor gains focus
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const handleFocus = () => {
      const pending = pendingRef.current;
      if (pending.size > 0) {
        for (const apply of pending.values()) {
          apply();
        }
        pendingRef.current = new Map();
      }
    };

    view.dom.addEventListener("focusin", handleFocus);
    return () => view.dom.removeEventListener("focusin", handleFocus);
  }, [viewRef]);

  // Helper: dispatch immediately if focused, defer if not
  const dispatchOrDefer = useCallback(
    (key: string, fn: () => void) => {
      if (viewRef.current?.hasFocus) {
        fn();
      } else {
        pendingRef.current.set(key, fn);
      }
    },
    [viewRef],
  );

  // Update theme
  useEffect(() => {
    const actualTheme = resolvedTheme === "dark" ? "dark" : "light";
    dispatchOrDefer("theme", () => {
      viewRef.current?.dispatch({
        effects: compartments.theme.reconfigure(
          getThemeExtensions(actualTheme),
        ),
      });
    });
  }, [resolvedTheme, compartments, viewRef, dispatchOrDefer]);

  // Update dialect extensions (heavy - only when dialect changes)
  useEffect(() => {
    dispatchOrDefer("dialect", () => {
      viewRef.current?.dispatch({
        effects: compartments.dialect.reconfigure([
          ...createDialectLinter(effectiveDialect, { connectionId, schema }),
          ...dialectExtensions,
        ]),
      });
    });
  }, [
    effectiveDialect,
    dialectExtensions,
    compartments,
    connectionId,
    schema,
    viewRef,
    dispatchOrDefer,
  ]);

  // Update completion extension (lightweight - separate from dialect)
  useEffect(() => {
    dispatchOrDefer("completion", () => {
      viewRef.current?.dispatch({
        effects: compartments.completion.reconfigure(completionExtension),
      });
    });
  }, [completionExtension, compartments, viewRef, dispatchOrDefer]);

  // Update read-only
  useEffect(() => {
    dispatchOrDefer("readOnly", () => {
      viewRef.current?.dispatch({
        effects: compartments.readOnly.reconfigure(
          EditorViewClass.editable.of(!readOnly),
        ),
      });
    });
  }, [readOnly, compartments, viewRef, dispatchOrDefer]);

  // Update placeholder
  useEffect(() => {
    dispatchOrDefer("placeholder", () => {
      viewRef.current?.dispatch({
        effects: compartments.placeholder.reconfigure(
          placeholder ? placeholderExt(placeholder) : [],
        ),
      });
    });
  }, [placeholder, compartments, viewRef, dispatchOrDefer]);
}
