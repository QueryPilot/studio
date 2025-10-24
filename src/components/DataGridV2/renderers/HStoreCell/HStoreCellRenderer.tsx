import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { truncateTextToWidth } from "../../utils/textUtils";
import { hstoreDisplayText } from "./hstoreFormat.ts";
import { HStoreCellEditorWithProps } from "./HStoreCellEditor.tsx";
import { type HStoreCustomCell } from "./types";

const fontFamily =
  "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";

const HStoreCellRenderer: CustomCellRenderer<HStoreCustomCell> = {
  isMatch: (cell: CustomCell): cell is HStoreCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "hstore-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;
    const isNull = value == null;
    const baseFont = `${theme.baseFontStyle} ${fontFamily}`;

    ctx.fillStyle = isNull ? "rgba(127,127,127,0.7)" : theme.textDark;
    ctx.font = isNull ? `italic ${baseFont}` : baseFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const padding =
      typeof theme.cellHorizontalPadding === "number"
        ? theme.cellHorizontalPadding
        : 8;
    const maxWidth = Math.max(0, rect.width - padding * 2);

    const displayText = isNull
      ? "NULL"
      : truncateTextToWidth(hstoreDisplayText(value), maxWidth, ctx.font);

    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);

    return true;
  },

  provideEditor: () => ({
    editor: HStoreCellEditorWithProps,
    disablePadding: true,
    disableStyling: false,
  }),
};

export default HStoreCellRenderer;
