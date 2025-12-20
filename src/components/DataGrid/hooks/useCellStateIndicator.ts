import { useCallback, useMemo } from 'react';
import { useCellStateStore } from '../stores/cellStateStore';
import { useValidationStore } from '@/stores/validationStore';
import { createCellKey, type CellState } from '../types/cellState';

interface UseCellStateIndicatorOptions {
  tableKey: string;
}

export interface CellIndicator {
  state: CellState;
  isDirty: boolean;
  hasError: boolean;
  errorMessage?: string;
  errorHint?: string;
}

export interface UseCellStateIndicatorResult {
  getCellIndicator: (rowIndex: number, columnField: string) => CellIndicator;
  hasDirtyCells: boolean;
  hasErrorCells: boolean;
  dirtyCellCount: number;
  errorCellCount: number;
}

export function useCellStateIndicator({
  tableKey,
}: UseCellStateIndicatorOptions): UseCellStateIndicatorResult {
  const getCellState = useCellStateStore((s) => s.getCellState);
  const getCellData = useCellStateStore((s) => s.getCellData);
  const cells = useCellStateStore((s) => s.cells);

  const getValidationError = useValidationStore((s) => s.getError);
  const validationErrors = useValidationStore((s) => s.errors);

  const getCellIndicator = useCallback(
    (rowIndex: number, columnField: string): CellIndicator => {
      const cellKey = createCellKey(tableKey, rowIndex, columnField);
      const state = getCellState(cellKey);
      const cellData = getCellData(cellKey);
      const validationError = getValidationError(cellKey);

      // Validation errors take precedence
      if (validationError) {
        return {
          state: 'error',
          isDirty: state === 'dirty',
          hasError: true,
          errorMessage: validationError.message,
          errorHint: validationError.hint,
        };
      }

      // Cell state error
      if (state === 'error' && cellData?.error) {
        return {
          state: 'error',
          isDirty: false,
          hasError: true,
          errorMessage: cellData.error,
        };
      }

      // Dirty state
      if (state === 'dirty') {
        return {
          state: 'dirty',
          isDirty: true,
          hasError: false,
        };
      }

      // Other states
      return {
        state,
        isDirty: false,
        hasError: false,
      };
    },
    [tableKey, getCellState, getCellData, getValidationError]
  );

  const { dirtyCellCount, errorCellCount } = useMemo(() => {
    const prefix = `${tableKey}:`;
    let dirty = 0;
    let errors = 0;

    // Count cell state errors
    for (const [key, data] of cells) {
      if (key.startsWith(prefix)) {
        if (data.state === 'dirty') dirty++;
        if (data.state === 'error') errors++;
      }
    }

    // Add validation errors
    for (const key of validationErrors.keys()) {
      if (key.startsWith(prefix)) {
        errors++;
      }
    }

    return { dirtyCellCount: dirty, errorCellCount: errors };
  }, [tableKey, cells, validationErrors]);

  const hasDirtyCells = dirtyCellCount > 0;
  const hasErrorCells = errorCellCount > 0;

  return useMemo(
    () => ({
      getCellIndicator,
      hasDirtyCells,
      hasErrorCells,
      dirtyCellCount,
      errorCellCount,
    }),
    [getCellIndicator, hasDirtyCells, hasErrorCells, dirtyCellCount, errorCellCount]
  );
}
