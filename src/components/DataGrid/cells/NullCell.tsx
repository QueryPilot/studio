import { memo } from "react";

interface NullCellProps {
  isNumeric?: boolean;
}

export const NullCell = memo(function NullCell({ isNumeric = false }: NullCellProps) {
  return (
    <span className={`text-muted-foreground italic text-xs block ${isNumeric ? 'text-right' : ''}`}>
      NULL
    </span>
  );
});

NullCell.displayName = "NullCell";