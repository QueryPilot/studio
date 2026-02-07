/**
 * SQL Editor Compartments Hook
 *
 * Handles the 5 dynamic reconfiguration useEffects for CodeMirror compartments.
 */

import { useEffect } from "react";
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
  // Update theme
  useEffect(() => {
    const actualTheme = resolvedTheme === "dark" ? "dark" : "light";
    viewRef.current?.dispatch({
      effects: compartments.theme.reconfigure(
        getThemeExtensions(actualTheme),
      ),
    });
  }, [resolvedTheme, compartments, viewRef]);

  // Update dialect extensions (heavy - only when dialect changes)
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.dialect.reconfigure([
        ...createDialectLinter(effectiveDialect, { connectionId, schema }),
        ...dialectExtensions,
      ]),
    });
  }, [
    effectiveDialect,
    dialectExtensions,
    compartments,
    connectionId,
    schema,
    viewRef,
  ]);

  // Update completion extension (lightweight - separate from dialect)
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.completion.reconfigure(completionExtension),
    });
  }, [completionExtension, compartments, viewRef]);

  // Update read-only
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.readOnly.reconfigure(
        EditorViewClass.editable.of(!readOnly),
      ),
    });
  }, [readOnly, compartments, viewRef]);

  // Update placeholder
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.placeholder.reconfigure(
        placeholder ? placeholderExt(placeholder) : [],
      ),
    });
  }, [placeholder, compartments, viewRef]);
}
