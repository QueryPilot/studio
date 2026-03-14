import type { CellState } from '../types/cellState';

// Semantic color constants for cell states
const AMBER = 'hsl(45 93% 47%)';
const RED = 'hsl(0 84% 60%)';

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
    border: 'var(--primary)',
    background: 'transparent',
  },
  editing: {
    border: 'var(--primary)',
    background: 'var(--background)',
  },
  dirty: {
    border: AMBER,
    background: 'hsl(45 93% 47% / 0.1)',
    indicator: AMBER,
  },
  error: {
    border: RED,
    background: 'hsl(0 84% 60% / 0.1)',
    indicator: RED,
  },
  inserted: {
    background: 'hsl(142 76% 36% / 0.15)',
  },
  deleted: {
    background: 'hsl(0 84% 60% / 0.15)',
  },
};

export const darkCellStateColors: CellStateColors = {
  focused: {
    border: 'var(--primary)',
    background: 'transparent',
  },
  editing: {
    border: 'var(--primary)',
    background: 'var(--background)',
  },
  dirty: {
    border: AMBER,
    background: 'hsl(45 93% 47% / 0.15)',
    indicator: AMBER,
  },
  error: {
    border: RED,
    background: 'hsl(0 84% 60% / 0.15)',
    indicator: RED,
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
