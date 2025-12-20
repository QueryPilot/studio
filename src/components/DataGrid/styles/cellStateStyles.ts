import type { CellState } from '../types/cellState';

export interface CellStateColors {
  focused: {
    border: string;
    background: string;
  };
  editing: {
    border: string;
    background: string;
  };
  dirty: {
    border: string;
    background: string;
    indicator: string;
  };
  error: {
    border: string;
    background: string;
    indicator: string;
  };
  inserted: {
    background: string;
  };
  deleted: {
    background: string;
  };
}

export const lightCellStateColors: CellStateColors = {
  focused: {
    border: 'hsl(var(--primary))',
    background: 'transparent',
  },
  editing: {
    border: 'hsl(var(--primary))',
    background: 'hsl(var(--background))',
  },
  dirty: {
    border: 'hsl(45 93% 47%)', // amber
    background: 'hsl(45 93% 47% / 0.1)',
    indicator: 'hsl(45 93% 47%)',
  },
  error: {
    border: 'hsl(0 84% 60%)', // red
    background: 'hsl(0 84% 60% / 0.1)',
    indicator: 'hsl(0 84% 60%)',
  },
  inserted: {
    background: 'hsl(142 76% 36% / 0.15)', // green
  },
  deleted: {
    background: 'hsl(0 84% 60% / 0.15)', // red dimmed
  },
};

export const darkCellStateColors: CellStateColors = {
  focused: {
    border: 'hsl(var(--primary))',
    background: 'transparent',
  },
  editing: {
    border: 'hsl(var(--primary))',
    background: 'hsl(var(--background))',
  },
  dirty: {
    border: 'hsl(45 93% 47%)',
    background: 'hsl(45 93% 47% / 0.15)',
    indicator: 'hsl(45 93% 47%)',
  },
  error: {
    border: 'hsl(0 84% 60%)',
    background: 'hsl(0 84% 60% / 0.15)',
    indicator: 'hsl(0 84% 60%)',
  },
  inserted: {
    background: 'hsl(142 76% 36% / 0.2)',
  },
  deleted: {
    background: 'hsl(0 84% 60% / 0.2)',
  },
};

/**
 * Get cell background color based on state
 */
export function getCellStateBackground(
  state: CellState,
  colors: CellStateColors,
  isInserted = false,
  isDeleted = false
): string | undefined {
  if (isDeleted) return colors.deleted.background;
  if (isInserted) return colors.inserted.background;

  switch (state) {
    case 'dirty':
      return colors.dirty.background;
    case 'error':
      return colors.error.background;
    default:
      return undefined;
  }
}

/**
 * Get left border indicator color for dirty/error cells
 */
export function getCellStateIndicator(
  state: CellState,
  colors: CellStateColors
): string | undefined {
  switch (state) {
    case 'dirty':
      return colors.dirty.indicator;
    case 'error':
      return colors.error.indicator;
    default:
      return undefined;
  }
}
