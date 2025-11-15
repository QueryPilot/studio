import {
  type CustomCell,
  type CustomRenderer,
  GridCellKind,
} from "@glideapps/glide-data-grid";
import { type ColumnNameCustomCell } from "./types";

const ColumnNameCellRenderer: CustomRenderer<ColumnNameCustomCell> = {
  kind: GridCellKind.Custom,

  isMatch: (cell: CustomCell): cell is ColumnNameCustomCell => {
    return (
      typeof cell.data === "object" &&
      "kind" in cell.data &&
      cell.data.kind === "column-name-cell"
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { name, isPrimaryKey, isForeignKey } = cell.data;

    const fontFamily =
      "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
    const baseFont = `500 12px ${fontFamily}`;

    const padding = 8;
    const centerY = rect.y + rect.height / 2;

    // Draw column name (left-aligned)
    ctx.fillStyle = theme.textDark;
    ctx.font = baseFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(name, rect.x + padding, centerY);

    // Draw emoji indicators (right-aligned, smaller size)
    if (isPrimaryKey || isForeignKey) {
      ctx.save();
      const scale = 0.75; // 75% size
      ctx.font = "12px";
      ctx.textAlign = "right";
      const emojiX = rect.x + rect.width - padding;

      // Scale down the emoji
      ctx.translate(emojiX, centerY);
      ctx.scale(scale, scale);
      ctx.translate(-emojiX, -centerY);

      if (isPrimaryKey && isForeignKey) {
        // Both PK and FK: show both emojis
        ctx.fillText("🔑🔗", emojiX, centerY);
      } else if (isPrimaryKey) {
        // Primary key only
        ctx.fillText("🔑", emojiX, centerY);
      } else if (isForeignKey) {
        // Foreign key only
        ctx.fillText("🔗", emojiX, centerY);
      }

      ctx.restore();
    }

    return true;
  },

  provideEditor: () => undefined, // Read-only
};

export default ColumnNameCellRenderer;
