export type Orientation = "horizontal" | "vertical";
export type PanelType =
  | "editor"
  | "terminal"
  | "output"
  | "problems"
  | "custom";
export type Direction = "up" | "down" | "left" | "right";
export type DropPosition = "center" | "top" | "bottom" | "left" | "right";

export interface GridNode {
  id: string;
  type: "branch" | "leaf";
  orientation?: Orientation;
  splitRatio?: number;
  children?: GridNode[];
  content?: PanelContent;
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
}

export interface TabMetadata {
  title?: string;
  table?: string;
  schema?: string;
  type?: string;
  isView?: boolean;
  kind?: "Table" | "View" | "MaterializedView";
  database?: string;
  connectionId?: string;
  viewType?: string;
  sql?: string;
  /** Stable key identifying the logical object (e.g. `table-connId-schema-name`).
   *  Used for per-panel dedup: the same objectKey can exist in different panels
   *  but only once per panel. */
  objectKey?: string;
  /** When false, sort state is isolated per tab.
   *  Default (undefined/true) = sort is shared across all tabs of the same table. */
  syncSort?: boolean;
  [key: string]: unknown;
}

export interface PanelContent {
  id: string;
  type: PanelType;
  tabIds: string[];
  activeTabId: string;
  metadata?: Record<string, TabMetadata | undefined>;
}

export interface TabRenderState {
  isActiveTab: boolean;
  isPanelFocused: boolean;
  isInteractive: boolean;
}

export interface SplitAction {
  targetPanelId: string;
  direction: Direction;
  newPanelContent?: PanelContent;
  splitRatio?: number;
}

export interface WorkbenchConstraints {
  MAX_COLUMNS: number;
  MAX_ROWS: number;
  MIN_PANEL_WIDTH: number;
  MIN_PANEL_HEIGHT: number;
  MIN_SPLIT_RATIO: number;
  MAX_SPLIT_RATIO: number;
}

export interface ResizeContext {
  path: number[];
  initialRatio: number;
  startPosition: { x: number; y: number };
  orientation: Orientation;
}
