import type { CustomCell, CustomRenderer } from "@glideapps/glide-data-grid";
import { GridCellKind } from "@glideapps/glide-data-grid";
import type { ActionsCell } from "./types";

/**
 * SVG path data for Tabler icons (24x24 viewBox)
 * From https://github.com/tabler/tabler-icons
 */
const ICON_PATHS = {
  // IconTrash - delete action
  trash: [
    "M4 7l16 0",
    "M10 11l0 6",
    "M14 11l0 6",
    "M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12",
    "M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3",
  ],
  // IconArrowBackUp - undo action
  arrowBackUp: [
    "M9 14l-4 -4l4 -4",
    "M5 10h11a4 4 0 1 1 0 8h-1",
  ],
};

const ICON_SIZE = 16;
const MUTED_COLOR = "#6b7280"; // gray-500

/**
 * Draw an icon using SVG path data on canvas
 */
function drawIcon(
  ctx: CanvasRenderingContext2D,
  paths: string[],
  centerX: number,
  centerY: number,
  size: number,
  color: string
): void {
  ctx.save();

  // Translate to center position and adjust for icon size
  ctx.translate(centerX - size / 2, centerY - size / 2);

  // Scale from 24x24 viewBox to target size
  const scale = size / 24;
  ctx.scale(scale, scale);

  // Set up stroke style (Tabler icons use stroke-based rendering)
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Draw all paths
  for (const pathData of paths) {
    const path = new Path2D(pathData);
    ctx.stroke(path);
  }

  ctx.restore();
}

export const ActionsCellRenderer: CustomRenderer<ActionsCell> = {
  kind: GridCellKind.Custom,

  isMatch: (cell: CustomCell): cell is ActionsCell => {
    return (
      typeof cell.data === "object" &&
      cell.data !== null &&
      "kind" in cell.data &&
      (cell.data as Record<string, unknown>).kind === "actions-cell"
    );
  },

  draw: (args, cell) => {
    const { ctx, rect } = args;
    const { isPendingDelete } = cell.data;

    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;

    // Choose icon based on pending delete state
    const iconPaths = isPendingDelete ? ICON_PATHS.arrowBackUp : ICON_PATHS.trash;

    // Draw the icon
    drawIcon(ctx, iconPaths, centerX, centerY, ICON_SIZE, MUTED_COLOR);

    return true;
  },

  // No editor - actions are triggered by click, handled in parent component
  provideEditor: () => undefined,
};
