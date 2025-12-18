import { useCallback, useMemo, useRef } from "react";
import type { GridColumnV2 } from "../types";
import { validateCell, type ValidationResult } from "./validators";

interface ValidationState {
  [cellKey: string]: ValidationResult;
}

interface UseValidationOptions {
  columns: GridColumnV2[];
  enabled?: boolean;
}

interface UseValidationResult {
  validate: (value: unknown, column: GridColumnV2) => ValidationResult;
  validateByIndex: (value: unknown, columnIndex: number) => ValidationResult;
  getValidationError: (rowIndex: number, columnIndex: number) => string | undefined;
  setValidationResult: (
    rowIndex: number,
    columnIndex: number,
    result: ValidationResult
  ) => void;
  clearValidation: (rowIndex: number, columnIndex: number) => void;
  clearAllValidations: () => void;
  hasErrors: boolean;
  errorCount: number;
}

const VALID: ValidationResult = { valid: true };

function getCellKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}:${columnIndex}`;
}

export function useValidation({
  columns,
  enabled = true,
}: UseValidationOptions): UseValidationResult {
  const validationStateRef = useRef<ValidationState>({});
  const errorCountRef = useRef(0);

  const validate = useCallback(
    (value: unknown, column: GridColumnV2): ValidationResult => {
      if (!enabled) return VALID;
      return validateCell(value, column);
    },
    [enabled]
  );

  const validateByIndex = useCallback(
    (value: unknown, columnIndex: number): ValidationResult => {
      if (!enabled) return VALID;
      const column = columns[columnIndex];
      if (!column) return VALID;
      return validateCell(value, column);
    },
    [columns, enabled]
  );

  const setValidationResult = useCallback(
    (rowIndex: number, columnIndex: number, result: ValidationResult) => {
      const key = getCellKey(rowIndex, columnIndex);
      const prev = validationStateRef.current[key];

      // Update error count
      if (!result.valid && (prev?.valid ?? true)) {
        errorCountRef.current++;
      } else if (result.valid && prev && !prev.valid) {
        errorCountRef.current = Math.max(0, errorCountRef.current - 1);
      }

      validationStateRef.current[key] = result;
    },
    []
  );

  const getValidationError = useCallback(
    (rowIndex: number, columnIndex: number): string | undefined => {
      const key = getCellKey(rowIndex, columnIndex);
      const result = validationStateRef.current[key];
      return result?.valid === false ? result.error : undefined;
    },
    []
  );

  const clearValidation = useCallback(
    (rowIndex: number, columnIndex: number) => {
      const key = getCellKey(rowIndex, columnIndex);
      const prev = validationStateRef.current[key];
      if (prev && !prev.valid) {
        errorCountRef.current = Math.max(0, errorCountRef.current - 1);
      }
      delete validationStateRef.current[key];
    },
    []
  );

  const clearAllValidations = useCallback(() => {
    validationStateRef.current = {};
    errorCountRef.current = 0;
  }, []);

  return useMemo(
    () => ({
      validate,
      validateByIndex,
      getValidationError,
      setValidationResult,
      clearValidation,
      clearAllValidations,
      get hasErrors() {
        return errorCountRef.current > 0;
      },
      get errorCount() {
        return errorCountRef.current;
      },
    }),
    [
      validate,
      validateByIndex,
      getValidationError,
      setValidationResult,
      clearValidation,
      clearAllValidations,
    ]
  );
}
