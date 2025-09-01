export type Orientation = 'horizontal' | 'vertical';
export type PanelType = 'editor' | 'terminal' | 'output' | 'problems' | 'custom';
export type Direction = 'up' | 'down' | 'left' | 'right';
export type DropPosition = 'center' | 'top' | 'bottom' | 'left' | 'right';

export interface GridNode {
  id: string;
  type: 'branch' | 'leaf';
  orientation?: Orientation;
  splitRatio?: number;
  children?: GridNode[];
  content?: PanelContent;
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
}

export interface PanelContent {
  id: string;
  type: PanelType;
  tabIds: string[];
  activeTabId: string;
  metadata?: Record<string, any>;
}

export interface SplitAction {
  targetPanelId: string;
  direction: Direction;
  newPanelContent?: PanelContent;
  splitRatio?: number;
}

export interface WorkbenchConstraints {
  MAX_HORIZONTAL_PANELS: number;
  MAX_VERTICAL_PANELS: number;
  MIN_PANEL_WIDTH: number;
  MIN_PANEL_HEIGHT: number;
  MIN_SPLIT_RATIO: number;
  MAX_SPLIT_RATIO: number;
  MAX_TREE_DEPTH: number;
}

export interface DragDropContext {
  draggedTab: { id: string; panelId: string } | null;
  draggedPanel: string | null;
  dropTarget: { panelId: string } | null;
  dropPosition: DropPosition | null;
}

export interface ResizeContext {
  path: number[];
  initialRatio: number;
  startPosition: { x: number; y: number };
  orientation: Orientation;
}