import {
  type CustomCell,
  type CustomRenderer,
  GridCellKind,
} from "@glideapps/glide-data-grid";
import { type IndexNameCustomCell } from "./types";

const IndexNameCellRenderer: CustomRenderer<IndexNameCustomCell> = {
  kind: GridCellKind.Custom,

  isMatch: (cell: CustomCell): cell is IndexNameCustomCell => {
    return (
      typeof cell.data === "object" &&
      "kind" in cell.data &&
      cell.data.kind === "index-name-cell"
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { name, isPrimary, isUnique } = cell.data;

    const fontFamily =
      "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
    const baseFont = `500 12px ${fontFamily}`;

    const padding = 8;
    const badgeGap = 8;

    // Draw index name (medium weight)
    ctx.fillStyle = theme.textDark;
    ctx.font = baseFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const nameWidth = ctx.measureText(name).width;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(name, rect.x + padding, centerY);

    // Draw badge if needed
    let badgeX = rect.x + padding + nameWidth + badgeGap;

    if (isPrimary) {
      drawBadge(ctx, "PRIMARY", badgeX, centerY, "#ca8a04", fontFamily);
    } else if (isUnique) {
      drawBadge(ctx, "UNIQUE", badgeX, centerY, "#059669", fontFamily);
    }

    return true;
  },

  provideEditor: () => undefined, // Read-only
};

function drawBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  fontFamily: string,
) {
  const badgeFont = `600 10px ${fontFamily}`;
  ctx.font = badgeFont;

  const metrics = ctx.measureText(text);
  const badgeWidth = metrics.width + 12;
  const badgeHeight = 16;

  // Badge background (semi-transparent)
  ctx.fillStyle = color + "20"; // 12.5% opacity
  const badgeY = y - badgeHeight / 2;
  ctx.fillRect(x, badgeY, badgeWidth, badgeHeight);

  // Badge text
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + badgeWidth / 2, y);
}

export default IndexNameCellRenderer;
