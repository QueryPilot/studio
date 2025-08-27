import { useState, useCallback } from 'react';
import type { ContextMenuPosition } from '../components/DataGridContextMenu';

interface UseContextMenuProps {
  onShowPreview: () => void;
  onDelete: (rowIndices: number[]) => void;
}

export function useContextMenu(_props: UseContextMenuProps) {
  const [menuPosition, setMenuPosition] = useState<ContextMenuPosition | null>(null);
  const [contextData, setContextData] = useState<{
    rowIndex: number;
    columnIndex: number;
    cellValue: any;
  } | null>(null);

  const handleContextMenu = useCallback((
    event: React.MouseEvent,
    rowIndex: number,
    columnIndex: number,
    cellValue: any
  ) => {
    event.preventDefault();
    event.stopPropagation();
    
    setMenuPosition({
      x: event.clientX,
      y: event.clientY,
    });
    
    setContextData({
      rowIndex,
      columnIndex,
      cellValue,
    });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuPosition(null);
    setContextData(null);
  }, []);

  return {
    menuPosition,
    contextData,
    handleContextMenu,
    closeMenu,
  };
}