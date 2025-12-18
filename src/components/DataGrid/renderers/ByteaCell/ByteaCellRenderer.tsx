import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { ByteaCellEditorWithProps } from "./ByteaCellEditor";
import { type ByteaCustomCell } from "./types";
import { getCachedThemeValues } from "../../utils/renderCache";
import { getByteaPreview } from "./utils";

// Badge colors
const BINARY_BADGE_BG = "#3b82f6";
const BINARY_BADGE_FG = "#ffffff";

const ByteaCellRenderer: CustomCellRenderer<ByteaCustomCell> = {
  isMatch: (cell: CustomCell): cell is ByteaCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "bytea-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;

    // Use cached theme values
    const cachedTheme = getCachedThemeValues(theme);

    if (value == null) {
      // Draw NULL
      ctx.fillStyle = cachedTheme.nullTextColor;
      ctx.font = cachedTheme.italicFont;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("NULL", rect.x + cachedTheme.cellHorizontalPadding, rect.y + rect.height / 2);
      return true;
    }

    // Draw badge-style display
    const text = getByteaPreview(value);
    const padding = cachedTheme.cellHorizontalPadding;
    const badgePadding = 6;
    const badgeHeight = 18;

    // Measure text
    ctx.font = "500 10px system-ui, sans-serif";
    const textWidth = ctx.measureText(text).width;
    const badgeWidth = textWidth + badgePadding * 2;

    // Draw badge background
    const badgeX = rect.x + padding;
    const badgeY = rect.y + (rect.height - badgeHeight) / 2;

    ctx.fillStyle = BINARY_BADGE_BG;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 4);
    ctx.fill();

    // Draw badge text
    ctx.fillStyle = BINARY_BADGE_FG;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, badgeX + badgePadding, rect.y + rect.height / 2);

    return true;
  },

  provideEditor: (cell) => {
    if (cell.readonly) {
      return undefined;
    }
    return {
      editor: ByteaCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default ByteaCellRenderer;

