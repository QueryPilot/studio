import type { CustomCell } from "@glideapps/glide-data-grid";
import type { IndexColumnsCell } from "./types";
import type { CustomCellRenderer } from "@/components/DataGrid/types";
import { IndexColumnsCellEditorWithProps } from "./IndexColumnsCellEditor";

const CELL_PADDING = 8;
const TAG_GAP = 4;
const TAG_PADDING_H = 6;
const TAG_PADDING_V = 2;
const TAG_RADIUS = 3;
const TAG_FONT_SIZE = 11;

// Colors for tags
const TAG_TEXT_COLOR = "#3b82f6";
const TAG_TEXT_COLOR_LOCKED = "rgba(127, 127, 127, 0.7)";
const TAG_BG_COLOR = "rgba(59, 130, 246, 0.1)";
const TAG_BG_COLOR_LOCKED = "rgba(127, 127, 127, 0.08)";
const TAG_BORDER_COLOR = "rgba(59, 130, 246, 0.2)";
const TAG_BORDER_COLOR_LOCKED = "rgba(127, 127, 127, 0.15)";
const OVERFLOW_TEXT_COLOR = "#6b7280";

export const IndexColumnsCellRenderer: CustomCellRenderer<IndexColumnsCell> = {
  isMatch: (cell: CustomCell): cell is IndexColumnsCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "index-columns-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { columns, isLocked } = cell.data;

    ctx.save();

    // Set up monospace font for tags
    const baseFontSize = theme.baseFontStyle.split(" ").slice(1).join(" ");
    const fontFamily = baseFontSize.includes("px")
      ? baseFontSize.split("px")[1]?.trim() || "monospace"
      : "monospace";
    ctx.font = `500 ${TAG_FONT_SIZE}px ${fontFamily}`;

    const textColor = isLocked ? TAG_TEXT_COLOR_LOCKED : TAG_TEXT_COLOR;
    const bgColor = isLocked ? TAG_BG_COLOR_LOCKED : TAG_BG_COLOR;
    const borderColor = isLocked ? TAG_BORDER_COLOR_LOCKED : TAG_BORDER_COLOR;

    // Calculate available width
    const availableWidth = rect.width - CELL_PADDING * 2;

    // Measure each tag and determine which ones fit
    const tagMeasurements: { text: string; width: number }[] = [];
    for (const col of columns) {
      const textWidth = ctx.measureText(col).width;
      const tagWidth = textWidth + TAG_PADDING_H * 2;
      tagMeasurements.push({ text: col, width: tagWidth });
    }

    // Calculate how many tags we can fit
    let totalWidth = 0;
    let fittingTagCount = 0;
    const overflowIndicatorWidth = ctx.measureText("+99").width + TAG_PADDING_H * 2 + TAG_GAP;

    for (let i = 0; i < tagMeasurements.length; i++) {
      const tag = tagMeasurements[i];
      if (!tag) continue;
      const tagWidth = tag.width + (i > 0 ? TAG_GAP : 0);
      const remainingTags = tagMeasurements.length - i - 1;
      const needsOverflow = remainingTags > 0;
      const spaceNeeded = needsOverflow ? tagWidth + overflowIndicatorWidth : tagWidth;

      if (totalWidth + spaceNeeded <= availableWidth) {
        totalWidth += tagWidth;
        fittingTagCount++;
      } else {
        break;
      }
    }

    // If no tags fit at all, try to fit at least a truncated first tag
    if (fittingTagCount === 0 && columns.length > 0) {
      fittingTagCount = 1;
    }

    // Draw fitting tags
    let x = rect.x + CELL_PADDING;
    const y = rect.y + rect.height / 2;

    for (let i = 0; i < fittingTagCount; i++) {
      const tag = tagMeasurements[i];
      if (!tag) continue;
      const tagHeight = TAG_FONT_SIZE + TAG_PADDING_V * 2;
      const tagTop = y - tagHeight / 2;

      // Draw tag background
      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.roundRect(x, tagTop, tag.width, tagHeight, TAG_RADIUS);
      ctx.fill();

      // Draw tag border
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw tag text
      ctx.fillStyle = textColor;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(tag.text, x + TAG_PADDING_H, y);

      x += tag.width + TAG_GAP;
    }

    // Draw overflow indicator if needed
    const overflowCount = columns.length - fittingTagCount;
    if (overflowCount > 0) {
      const overflowText = `+${overflowCount}`;
      ctx.fillStyle = OVERFLOW_TEXT_COLOR;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(overflowText, x, y);
    }

    ctx.restore();

    return true;
  },

  provideEditor: (cell) => {
    // Don't provide editor for locked cells
    if (cell.data.isLocked) {
      return undefined;
    }

    return {
      editor: IndexColumnsCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default IndexColumnsCellRenderer;
