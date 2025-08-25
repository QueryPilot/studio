/**
 * Hook for managing cell edit mode state
 */
import { useState, useCallback, useRef, useEffect } from "react";
import type { CellValue } from "../types";

interface EditState {
  editingCell: string | null; // "rowId:columnId" format
  editingValue: CellValue | null;
  originalValue: CellValue | null;
  isValidValue: boolean;
}

interface UseEditModeProps {
  onCellEdit?: (rowId: string, columnId: string, value: CellValue) => void;
  editableColumns?: Set<string>;
}

export function useEditMode({ onCellEdit, editableColumns }: UseEditModeProps) {
  const [editState, setEditState] = useState<EditState>({
    editingCell: null,
    editingValue: null,
    originalValue: null,
    isValidValue: true,
  });

  const editTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Check if a column is editable
  const isColumnEditable = useCallback(
    (columnId: string): boolean => {
      if (!editableColumns) return true; // All editable by default
      return editableColumns.has(columnId);
    },
    [editableColumns],
  );

  // Start editing a cell
  const startEdit = useCallback(
    (cellId: string, value: CellValue | null) => {
      const [, columnId] = cellId.split(":");

      if (!isColumnEditable(columnId || "")) {
        return false;
      }

      setEditState({
        editingCell: cellId,
        editingValue: value,
        originalValue: value,
        isValidValue: true,
      });

      return true;
    },
    [isColumnEditable],
  );

  // Update edit value
  const updateEditValue = useCallback((value: CellValue | null) => {
    setEditState((prev) => ({
      ...prev,
      editingValue: value,
      isValidValue: true, // Validation should be done in cell components
    }));
  }, []);

  // Save edit
  const saveEdit = useCallback(() => {
    if (!editState.editingCell || !editState.isValidValue) {
      return false;
    }

    const [rowId, columnId] = editState.editingCell.split(":");

    if (
      rowId &&
      columnId &&
      editState.editingValue !== undefined &&
      editState.editingValue !== null
    ) {
      onCellEdit?.(rowId, columnId, editState.editingValue);

      setEditState({
        editingCell: null,
        editingValue: null,
        originalValue: null,
        isValidValue: true,
      });

      return true;
    }

    return false;
  }, [editState, onCellEdit]);

  // Cancel edit
  const cancelEdit = useCallback(() => {
    setEditState({
      editingCell: null,
      editingValue: null,
      originalValue: null,
      isValidValue: true,
    });
  }, []);

  // Handle double-click to edit
  const handleDoubleClick = useCallback(
    (cellId: string, value: CellValue | null) => {
      if (editState.editingCell === cellId) {
        return; // Already editing this cell
      }

      // Save any current edit
      if (editState.editingCell) {
        saveEdit();
      }

      // Start editing the new cell
      startEdit(cellId, value);
    },
    [editState.editingCell, saveEdit, startEdit],
  );

  // Handle Enter key to start edit
  const handleEnterKey = useCallback(
    (cellId: string, value: CellValue | null) => {
      if (editState.editingCell === cellId) {
        saveEdit();
      } else {
        startEdit(cellId, value);
      }
    },
    [editState.editingCell, saveEdit, startEdit],
  );

  // Handle Escape key to cancel edit
  const handleEscapeKey = useCallback(() => {
    if (editState.editingCell) {
      cancelEdit();
    }
  }, [editState.editingCell, cancelEdit]);

  // Handle click outside to save edit
  const handleClickOutside = useCallback(
    (targetCellId?: string) => {
      if (editState.editingCell && editState.editingCell !== targetCellId) {
        saveEdit();
      }
    },
    [editState.editingCell, saveEdit],
  );

  // Set validation state
  const setValidation = useCallback((isValid: boolean) => {
    setEditState((prev) => ({
      ...prev,
      isValidValue: isValid,
    }));
  }, []);

  // Check if a cell is being edited
  const isEditing = useCallback(
    (cellId: string): boolean => {
      return editState.editingCell === cellId;
    },
    [editState.editingCell],
  );

  // Get edit value for a cell
  const getEditValue = useCallback(
    (cellId: string): CellValue | null => {
      if (editState.editingCell === cellId) {
        return editState.editingValue;
      }
      return null;
    },
    [editState.editingCell, editState.editingValue],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (editTimeoutRef.current) {
        clearTimeout(editTimeoutRef.current);
      }
    };
  }, []);

  return {
    // State
    editingCell: editState.editingCell,
    editingValue: editState.editingValue,
    originalValue: editState.originalValue,
    isValidValue: editState.isValidValue,

    // Methods
    startEdit,
    updateEditValue,
    saveEdit,
    cancelEdit,
    handleDoubleClick,
    handleEnterKey,
    handleEscapeKey,
    handleClickOutside,
    setValidation,

    // Check methods
    isEditing,
    getEditValue,
    isColumnEditable,
  };
}
