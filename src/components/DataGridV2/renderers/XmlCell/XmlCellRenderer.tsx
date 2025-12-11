import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { XmlCellEditorWithProps } from "./XmlCellEditor";
import { truncateTextMiddleToWidth } from "../../utils/textUtils";
import { type XmlCustomCell } from "./types";
import {
  getCachedThemeValues,
  MONOSPACE_FONT_FAMILY,
} from "../../utils/renderCache";
import { getXmlPreview, validateXml } from "./utils";

// Pre-cached monospace font for XML
const MONO_FONT = `400 11px ${MONOSPACE_FONT_FAMILY}`;

// Color for invalid XML
const INVALID_COLOR = "#ef4444";

// Color for XML tags
const TAG_COLOR = "#0ea5e9";

const XmlCellRenderer: CustomCellRenderer<XmlCustomCell> = {
  isMatch: (cell: CustomCell): cell is XmlCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "xml-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;

    // Use cached theme values
    const cachedTheme = getCachedThemeValues(theme);

    let text: string;
    let color: string;

    if (value == null) {
      text = "NULL";
      color = cachedTheme.nullTextColor;
      ctx.font = cachedTheme.italicFont;
    } else {
      text = getXmlPreview(value);
      const validation = validateXml(value);

      if (!validation.isValid) {
        color = INVALID_COLOR;
      } else if (text.startsWith("<")) {
        color = TAG_COLOR;
      } else {
        color = cachedTheme.textDark;
      }
      ctx.font = MONO_FONT;
    }

    // Draw the text with left alignment
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const padding = cachedTheme.cellHorizontalPadding;

    const rightPadding = padding;
    const availableWidth = rect.width - padding - rightPadding;
    const displayText =
      availableWidth > 0
        ? truncateTextMiddleToWidth(text, availableWidth, {
            ctx,
            font: ctx.font,
          })
        : text;

    const x = rect.x + padding;
    const centerY = rect.y + rect.height / 2;
    ctx.fillText(displayText, x, centerY);

    return true;
  },

  provideEditor: (cell) => {
    if (cell.readonly) {
      return undefined;
    }
    return {
      editor: XmlCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default XmlCellRenderer;

