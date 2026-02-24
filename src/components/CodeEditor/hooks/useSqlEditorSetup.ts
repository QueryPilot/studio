/**
 * SQL Editor Setup Hook
 *
 * Handles compartment creation, initial doc state, and dialect detection.
 */

import { useState, useCallback, useMemo, useRef } from "react";
import { Compartment } from "@codemirror/state";
import { debounce } from "@/utils/debounce";
import { detectSqlDialect } from "@/utils/dialectDetector";
import type { SqlDialect } from "../types";

export interface EditorCompartments {
  theme: Compartment;
  dialect: Compartment;
  completion: Compartment;
  readOnly: Compartment;
  placeholder: Compartment;
}

function createCompartments(): EditorCompartments {
  return {
    theme: new Compartment(),
    dialect: new Compartment(),
    completion: new Compartment(),
    readOnly: new Compartment(),
    placeholder: new Compartment(),
  };
}

interface UseSqlEditorSetupOptions {
  initialValue: string;
  value?: string;
  dbType: string;
  dialectOverride?: SqlDialect;
  onDialectDetected?: (dialect: SqlDialect) => void;
}

export function useSqlEditorSetup({
  initialValue,
  value,
  dbType,
  dialectOverride,
  onDialectDetected,
}: UseSqlEditorSetupOptions) {
  // Determine startup value: value prop takes precedence over initialValue
  const startValue = value !== undefined ? value : initialValue;

  const [currentDialect, setCurrentDialect] = useState<SqlDialect>(() =>
    detectSqlDialect(dbType, startValue),
  );

  // Instance-level compartments - fixes state corruption across multiple editors
  const [compartments] = useState<EditorCompartments>(() =>
    createCompartments(),
  );

  // Uncontrolled mode to avoid "typing latch" bug
  const [initialDoc] = useState(startValue);

  // Keep a ref-stable callback for dialect detection notifications
  const onDialectDetectedRef = useRef(onDialectDetected);
  onDialectDetectedRef.current = onDialectDetected;

  // Debounced dialect detection
  const handleDialectDetection = useCallback(
    (val: string) => {
      const detected = detectSqlDialect(dbType, val);
      setCurrentDialect(detected);
      onDialectDetectedRef.current?.(detected);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dbType],
  );

  const detectDialect = useMemo(
    () => debounce(handleDialectDetection, 500),
    [handleDialectDetection],
  );

  // Use override or detected dialect
  const effectiveDialect = dialectOverride ?? currentDialect;

  return {
    initialDoc,
    compartments,
    effectiveDialect,
    detectDialect,
  };
}
