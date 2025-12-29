import { type CustomCell } from "@glideapps/glide-data-grid";
import {
  type IndexNameCustomCell,
  type EditableIndexNameCell,
} from "./types";
import { IndexNameCellEditorWithProps } from "./IndexNameCellEditor";
import { type CustomCellRenderer } from "@/components/DataGrid/types";

type IndexNameCell = IndexNameCustomCell | EditableIndexNameCell;

const IndexNameCellRenderer: CustomCellRenderer<IndexNameCell> = {
  isMatch: (cell: CustomCell): cell is IndexNameCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data &&
        typeof data === "object" &&
        (data.kind === "index-name-cell" ||
          data.kind === "editable-index-name-cell"),
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { name, isPrimary } = cell.data;
    const isLocked =
      "isLocked" in cell.data
        ? (cell.data as { isLocked: boolean }).isLocked
        : false;

    const fontFamily =
      "Noto Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Arial, sans-serif";
    const baseFont = `500 12px ${fontFamily}`;

    const padding = 8;
    const centerY = rect.y + rect.height / 2;

    // Draw index name (left-aligned)
    ctx.fillStyle = theme.textDark;
    ctx.font = baseFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(name, rect.x + padding, centerY);

    // Draw key emoji for primary key (right-aligned, smaller size)
    if (isPrimary) {
      ctx.save();
      const scale = 0.75; // 75% size
      ctx.font = "12px";
      ctx.textAlign = "right";
      const emojiX = rect.x + rect.width - padding;

      // Scale down the emoji
      ctx.translate(emojiX, centerY);
      ctx.scale(scale, scale);
      ctx.translate(-emojiX, -centerY);

      ctx.fillText("🔑", emojiX, centerY);
      ctx.restore();
    }

    // Draw lock emoji for locked rows (right-aligned, next to key if present)
    if (isLocked) {
      ctx.save();
      const scale = 0.65; // 65% size for lock
      ctx.font = "12px";
      ctx.textAlign = "right";
      // Position lock to the left of key if key is present, otherwise at right edge
      const lockOffset = isPrimary ? 20 : 0;
      const emojiX = rect.x + rect.width - padding - lockOffset;

      // Scale down the emoji
      ctx.translate(emojiX, centerY);
      ctx.scale(scale, scale);
      ctx.translate(-emojiX, -centerY);

      ctx.fillText("🔒", emojiX, centerY);
      ctx.restore();
    }

    return true;
  },

  provideEditor: (cell) => {
    // Only provide editor for editable cells that are not locked
    if (cell.data.kind !== "editable-index-name-cell") {
      return undefined;
    }

    if ((cell as EditableIndexNameCell).data.isLocked) {
      return undefined;
    }

    return {
      editor: IndexNameCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default IndexNameCellRenderer;
