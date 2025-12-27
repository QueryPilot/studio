import { useState, useCallback, useMemo } from "react";
import { validateColumnName } from "./types";

/**
 * Validation state for a single cell
 */
export interface CellValidationState {
  isValid: boolean;
  error?: string;
}

/**
 * Context needed for validation
 */
export interface ValidationContext {
  /** All existing column names (including pending additions) */
  existingColumnNames: string[];
  /** Current column name when renaming - will be excluded from uniqueness check */
  currentColumnName?: string;
}

/**
 * Return type for the useStructureValidation hook
 */
export interface UseStructureValidationReturn {
  /** Get validation state for a specific cell */
  getCellValidation: (rowIndex: number, field: string) => CellValidationState;

  /** Validate a cell value and update state */
  validateCell: (
    rowIndex: number,
    field: string,
    value: string,
    context: ValidationContext
  ) => CellValidationState;

  /** Check if any cells have validation errors */
  hasValidationErrors: boolean;

  /** Clear validation state for a specific row */
  clearValidation: (rowIndex: number) => void;

  /** Clear all validation state */
  clearAllValidation: () => void;

  /** Get all validation errors as a map */
  getAllValidationErrors: () => Map<string, CellValidationState>;
}

// Key format: "rowIndex:field"
type ValidationKey = string;

/**
 * Generate a unique key for a cell
 */
function getCellKey(rowIndex: number, field: string): ValidationKey {
  return `${rowIndex}:${field}`;
}

/**
 * Parse a cell key back to row index and field
 */
function parseCellKey(key: ValidationKey): { rowIndex: number; field: string } {
  const colonIndex = key.indexOf(":");
  const rowIndexStr = key.substring(0, colonIndex);
  const field = key.substring(colonIndex + 1);
  return { rowIndex: parseInt(rowIndexStr, 10), field };
}

/**
 * Default valid state
 */
const VALID_STATE: CellValidationState = { isValid: true };

/**
 * Validate a data type value
 */
function validateDataType(value: string): CellValidationState {
  if (!value || value.trim() === "") {
    return { isValid: false, error: "Data type is required" };
  }

  const trimmedValue = value.trim();

  // Basic validation for common SQL data types
  // Allow common type patterns like: varchar(255), numeric(10,2), etc.
  const typePattern = /^[a-zA-Z_][a-zA-Z0-9_]*(\s*\(\s*\d+(\s*,\s*\d+)?\s*\))?(\s*(with|without)\s+time\s+zone)?(\[\])?$/i;

  if (!typePattern.test(trimmedValue)) {
    // More lenient check - just ensure it starts with a letter and contains valid chars
    const lenientPattern = /^[a-zA-Z][a-zA-Z0-9_\s\(\),\[\]]*$/;
    if (!lenientPattern.test(trimmedValue)) {
      return {
        isValid: false,
        error: "Invalid data type format",
      };
    }
  }

  return { isValid: true };
}

/**
 * Validate a default value expression
 */
function validateDefaultValue(value: string): CellValidationState {
  // Empty default is valid
  if (!value || value.trim() === "") {
    return { isValid: true };
  }

  const trimmedValue = value.trim();

  // Check for balanced parentheses
  let parenCount = 0;
  for (const char of trimmedValue) {
    if (char === "(") parenCount++;
    if (char === ")") parenCount--;
    if (parenCount < 0) {
      return { isValid: false, error: "Unbalanced parentheses in default value" };
    }
  }
  if (parenCount !== 0) {
    return { isValid: false, error: "Unbalanced parentheses in default value" };
  }

  // Check for balanced quotes
  let singleQuoteCount = 0;
  let doubleQuoteCount = 0;
  let escaped = false;
  for (const char of trimmedValue) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "'") singleQuoteCount++;
    if (char === '"') doubleQuoteCount++;
  }
  if (singleQuoteCount % 2 !== 0) {
    return { isValid: false, error: "Unbalanced single quotes in default value" };
  }
  if (doubleQuoteCount % 2 !== 0) {
    return { isValid: false, error: "Unbalanced double quotes in default value" };
  }

  return { isValid: true };
}

/**
 * Hook for managing validation state in the TableStructure grid
 *
 * Provides cell-level validation with support for:
 * - Column name validation (required, format, uniqueness, reserved keywords)
 * - Data type validation
 * - Default value validation
 */
export function useStructureValidation(): UseStructureValidationReturn {
  const [validationState, setValidationState] = useState<Map<ValidationKey, CellValidationState>>(
    () => new Map()
  );

  /**
   * Get validation state for a specific cell
   */
  const getCellValidation = useCallback(
    (rowIndex: number, field: string): CellValidationState => {
      const key = getCellKey(rowIndex, field);
      return validationState.get(key) ?? VALID_STATE;
    },
    [validationState]
  );

  /**
   * Validate a cell value based on the field type
   */
  const validateCell = useCallback(
    (
      rowIndex: number,
      field: string,
      value: string,
      context: ValidationContext
    ): CellValidationState => {
      let result: CellValidationState;

      switch (field) {
        case "column_name": {
          const validationResult = validateColumnName(
            value,
            context.existingColumnNames,
            context.currentColumnName
          );
          result = {
            isValid: validationResult.valid,
            error: validationResult.error,
          };
          break;
        }

        case "db_type": {
          result = validateDataType(value);
          break;
        }

        case "default": {
          result = validateDefaultValue(value);
          break;
        }

        default:
          // No validation for other fields
          result = VALID_STATE;
      }

      // Update state
      const key = getCellKey(rowIndex, field);
      setValidationState((prev) => {
        const next = new Map(prev);
        if (result.isValid) {
          // Remove valid entries to keep the map small
          next.delete(key);
        } else {
          next.set(key, result);
        }
        return next;
      });

      return result;
    },
    []
  );

  /**
   * Check if any cells have validation errors
   */
  const hasValidationErrors = useMemo(() => {
    return validationState.size > 0;
  }, [validationState]);

  /**
   * Clear validation state for a specific row
   */
  const clearValidation = useCallback((rowIndex: number) => {
    setValidationState((prev) => {
      const next = new Map(prev);
      // Remove all entries for this row
      for (const key of prev.keys()) {
        const { rowIndex: keyRowIndex } = parseCellKey(key);
        if (keyRowIndex === rowIndex) {
          next.delete(key);
        }
      }
      return next;
    });
  }, []);

  /**
   * Clear all validation state
   */
  const clearAllValidation = useCallback(() => {
    setValidationState(new Map());
  }, []);

  /**
   * Get all validation errors
   */
  const getAllValidationErrors = useCallback(() => {
    return new Map(validationState);
  }, [validationState]);

  return {
    getCellValidation,
    validateCell,
    hasValidationErrors,
    clearValidation,
    clearAllValidation,
    getAllValidationErrors,
  };
}

/**
 * Re-export validateColumnName for direct use
 */
export { validateColumnName };
