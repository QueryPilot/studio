import {
  GridCellKind,
  type CustomCell,
  type CustomRenderer,
} from "@glideapps/glide-data-grid";

// ---------------------------------------------------------------------------
// IndexKeyCell -- renders key chips like "email: 1", "status: -1", "body: text"
// ---------------------------------------------------------------------------

interface IndexKeyCellData {
  kind: "index-key-cell";
  keys: Record<string, 1 | -1 | "text">;
}

interface IndexKeyCell extends CustomCell<IndexKeyCellData> {
  kind: typeof GridCellKind.Custom;
}

const CHIP_BG = "rgba(59, 130, 246, 0.12)"; // blue-500 @ 12%
const CHIP_FG = "#3b82f6"; // blue-500
const CHIP_RADIUS = 4;
const CHIP_H_PAD = 6;
const CHIP_V_PAD = 2;
const CHIP_GAP = 4;
const CELL_PAD = 8;

export const IndexKeyCellRenderer: CustomRenderer<IndexKeyCell> = {
  kind: GridCellKind.Custom,

  isMatch: (cell: CustomCell): cell is IndexKeyCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "index-key-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { keys } = cell.data;

    const entries = Object.entries(keys);
    if (entries.length === 0) return true;

    ctx.save();
    ctx.font = "11px monospace";
    ctx.textBaseline = "middle";

    const centerY = rect.y + rect.height / 2;
    let x = rect.x + CELL_PAD;
    const maxX = rect.x + rect.width - CELL_PAD;

    for (const [key, dir] of entries) {
      const label = `${key}: ${String(dir)}`;
      const textWidth = ctx.measureText(label).width;
      const chipWidth = textWidth + CHIP_H_PAD * 2;
      const chipHeight = 18;

      // Stop rendering if the chip would overflow the cell
      if (x + chipWidth > maxX) {
        // Draw ellipsis indicator
        ctx.fillStyle = theme.textMedium;
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("...", x, centerY);
        break;
      }

      const chipY = centerY - chipHeight / 2;

      // Chip background
      ctx.fillStyle = CHIP_BG;
      ctx.beginPath();
      ctx.moveTo(x + CHIP_RADIUS, chipY);
      ctx.lineTo(x + chipWidth - CHIP_RADIUS, chipY);
      ctx.quadraticCurveTo(x + chipWidth, chipY, x + chipWidth, chipY + CHIP_RADIUS);
      ctx.lineTo(x + chipWidth, chipY + chipHeight - CHIP_RADIUS);
      ctx.quadraticCurveTo(x + chipWidth, chipY + chipHeight, x + chipWidth - CHIP_RADIUS, chipY + chipHeight);
      ctx.lineTo(x + CHIP_RADIUS, chipY + chipHeight);
      ctx.quadraticCurveTo(x, chipY + chipHeight, x, chipY + chipHeight - CHIP_RADIUS);
      ctx.lineTo(x, chipY + CHIP_RADIUS);
      ctx.quadraticCurveTo(x, chipY, x + CHIP_RADIUS, chipY);
      ctx.closePath();
      ctx.fill();

      // Chip text
      ctx.fillStyle = CHIP_FG;
      ctx.textAlign = "left";
      ctx.fillText(label, x + CHIP_H_PAD, centerY + CHIP_V_PAD / 2);

      x += chipWidth + CHIP_GAP;
    }

    ctx.restore();
    return true;
  },

  provideEditor: () => undefined,
};
