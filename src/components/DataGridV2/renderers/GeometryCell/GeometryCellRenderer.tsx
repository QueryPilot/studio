import { type CustomCell } from "@glideapps/glide-data-grid";
import type { CustomCellRenderer } from "../../types";
import { GeometryCellEditorWithProps } from "./GeometryCellEditor";
import { type GeometryCustomCell } from "./types";
import {
  getCachedThemeValues,
  MONOSPACE_FONT_FAMILY,
} from "../../utils/renderCache";
import { getTypeBadge, parseGeometry, generateSvgPreview } from "./utils";

// Pre-cached monospace font
const MONO_FONT = `400 10px ${MONOSPACE_FONT_FAMILY}`;

// Badge colors by geometry type
const TYPE_COLORS: Record<string, string> = {
  PT: "#22c55e", // green for point
  LS: "#3b82f6", // blue for linestring
  PG: "#f59e0b", // amber for polygon
  MPT: "#22c55e",
  MLS: "#3b82f6",
  MPG: "#f59e0b",
  GC: "#8b5cf6", // purple for collection
  "?": "#6b7280", // gray for unknown
  NULL: "#6b7280",
};

const GeometryCellRenderer: CustomCellRenderer<GeometryCustomCell> = {
  isMatch: (cell: CustomCell): cell is GeometryCustomCell => {
    const data = cell.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return false;

    const kind = data.kind as string;
    return kind === "geometry-cell" || kind === "geography-cell";
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { value } = cell.data;

    // Use cached theme values
    const cachedTheme = getCachedThemeValues(theme);
    const padding = cachedTheme.cellHorizontalPadding;

    if (value == null) {
      // Draw NULL
      ctx.fillStyle = cachedTheme.nullTextColor;
      ctx.font = cachedTheme.italicFont;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("NULL", rect.x + padding, rect.y + rect.height / 2);
      return true;
    }

    const badge = getTypeBadge(value);
    const badgeColor = TYPE_COLORS[badge] || TYPE_COLORS["?"];
    const parsed = parseGeometry(value);

    // Draw badge
    const badgeHeight = 16;
    const badgePadding = 4;
    ctx.font = "600 9px system-ui, sans-serif";
    const badgeWidth = ctx.measureText(badge).width + badgePadding * 2;

    const badgeX = rect.x + padding;
    const badgeY = rect.y + (rect.height - badgeHeight) / 2;

    // Badge background
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 3);
    ctx.fill();

    // Badge text
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(badge, badgeX + badgePadding, rect.y + rect.height / 2);

    // Draw mini SVG preview if space allows
    const previewX = badgeX + badgeWidth + 6;
    const previewSize = Math.min(rect.height - 8, 24);
    const availableWidth = rect.width - padding * 2 - badgeWidth - 10;

    if (availableWidth > previewSize + 40 && parsed.isValid) {
      const svgContent = generateSvgPreview(value, previewSize, previewSize);
      if (svgContent) {
        // Draw a simple representation using canvas
        ctx.save();
        ctx.translate(previewX, rect.y + (rect.height - previewSize) / 2);

        // Background
        ctx.fillStyle = theme.bgCell;
        ctx.strokeStyle = cachedTheme.borderColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(0, 0, previewSize, previewSize, 2);
        ctx.fill();
        ctx.stroke();

        // Draw simplified geometry indicator
        ctx.fillStyle = badgeColor;
        if (badge === "PT" || badge === "MPT") {
          ctx.beginPath();
          ctx.arc(previewSize / 2, previewSize / 2, 3, 0, Math.PI * 2);
          ctx.fill();
        } else if (badge === "LS" || badge === "MLS") {
          ctx.strokeStyle = badgeColor;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(4, previewSize - 4);
          ctx.lineTo(previewSize / 2, 4);
          ctx.lineTo(previewSize - 4, previewSize - 4);
          ctx.stroke();
        } else if (badge === "PG" || badge === "MPG") {
          ctx.globalAlpha = 0.3;
          ctx.beginPath();
          ctx.moveTo(previewSize / 2, 3);
          ctx.lineTo(previewSize - 3, previewSize - 3);
          ctx.lineTo(3, previewSize - 3);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = badgeColor;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.restore();
      }
    }

    // Draw coordinate preview
    const textX = availableWidth > previewSize + 40
      ? previewX + previewSize + 6
      : previewX;
    const textAvailable = rect.x + rect.width - textX - padding;

    if (textAvailable > 30) {
      ctx.font = MONO_FONT;
      ctx.fillStyle = cachedTheme.textMedium;

      let preview = parsed.coordinates || value;
      if (preview.length > 20) {
        preview = preview.substring(0, 20) + "...";
      }

      // Measure and truncate if needed
      let displayText = preview;
      while (ctx.measureText(displayText).width > textAvailable && displayText.length > 5) {
        displayText = displayText.substring(0, displayText.length - 4) + "...";
      }

      ctx.fillText(displayText, textX, rect.y + rect.height / 2);
    }

    return true;
  },

  provideEditor: (cell) => {
    if (cell.readonly) {
      return undefined;
    }
    return {
      editor: GeometryCellEditorWithProps,
      disablePadding: true,
      disableStyling: false,
    };
  },
};

export default GeometryCellRenderer;

