import {
  GridCellKind,
  type CustomCell,
  type CustomRenderer,
} from "@glideapps/glide-data-grid";
import { BSON_TYPE_COLORS } from "./utils";

// ---------------------------------------------------------------------------
// SchemaFieldCell — tree-indented field name with expand/collapse arrow
// ---------------------------------------------------------------------------

interface SchemaFieldCellData {
  kind: "schema-field-cell";
  field: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isRequired: boolean;
}

interface SchemaFieldCell extends CustomCell<SchemaFieldCellData> {
  kind: typeof GridCellKind.Custom;
}

const INDENT_PX = 16;
const ARROW_SIZE = 8;
const ARROW_PADDING = 4;
const REQUIRED_BADGE_TEXT = "req";
const REQUIRED_BADGE_BG = "rgba(245, 158, 11, 0.15)"; // amber
const REQUIRED_BADGE_FG = "#d97706"; // amber-600

export const SchemaFieldCellRenderer: CustomRenderer<SchemaFieldCell> = {
  kind: GridCellKind.Custom,

  isMatch: (cell: CustomCell): cell is SchemaFieldCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data && typeof data === "object" && data.kind === "schema-field-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { field, depth, hasChildren, isExpanded, isRequired } = cell.data;

    const padding = 8;
    const indent = depth * INDENT_PX;
    let x = rect.x + padding + indent;
    const centerY = rect.y + rect.height / 2;

    // Draw expand/collapse arrow
    if (hasChildren) {
      ctx.save();
      ctx.fillStyle = theme.textMedium;
      ctx.beginPath();
      if (isExpanded) {
        // Down-pointing triangle
        ctx.moveTo(x, centerY - ARROW_SIZE / 3);
        ctx.lineTo(x + ARROW_SIZE, centerY - ARROW_SIZE / 3);
        ctx.lineTo(x + ARROW_SIZE / 2, centerY + ARROW_SIZE / 2);
      } else {
        // Right-pointing triangle
        ctx.moveTo(x, centerY - ARROW_SIZE / 2);
        ctx.lineTo(x + ARROW_SIZE * 0.7, centerY);
        ctx.lineTo(x, centerY + ARROW_SIZE / 2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      x += ARROW_SIZE + ARROW_PADDING;
    } else {
      // Reserve same space for alignment even without arrow
      x += ARROW_SIZE + ARROW_PADDING;
    }

    // Draw field name in monospace
    ctx.save();
    ctx.font = "12px monospace";
    ctx.fillStyle = theme.textDark;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(field, x, centerY);
    const textMetrics = ctx.measureText(field);
    x += textMetrics.width + 6;
    ctx.restore();

    // Draw "req" badge if required
    if (isRequired) {
      ctx.save();
      ctx.font = "bold 9px sans-serif";
      const badgeWidth = ctx.measureText(REQUIRED_BADGE_TEXT).width + 8;
      const badgeHeight = 14;
      const badgeY = centerY - badgeHeight / 2;

      // Badge background
      ctx.fillStyle = REQUIRED_BADGE_BG;
      ctx.beginPath();
      const r = 3;
      ctx.moveTo(x + r, badgeY);
      ctx.lineTo(x + badgeWidth - r, badgeY);
      ctx.quadraticCurveTo(x + badgeWidth, badgeY, x + badgeWidth, badgeY + r);
      ctx.lineTo(x + badgeWidth, badgeY + badgeHeight - r);
      ctx.quadraticCurveTo(x + badgeWidth, badgeY + badgeHeight, x + badgeWidth - r, badgeY + badgeHeight);
      ctx.lineTo(x + r, badgeY + badgeHeight);
      ctx.quadraticCurveTo(x, badgeY + badgeHeight, x, badgeY + badgeHeight - r);
      ctx.lineTo(x, badgeY + r);
      ctx.quadraticCurveTo(x, badgeY, x + r, badgeY);
      ctx.closePath();
      ctx.fill();

      // Badge text
      ctx.fillStyle = REQUIRED_BADGE_FG;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(REQUIRED_BADGE_TEXT, x + badgeWidth / 2, centerY);
      ctx.restore();
    }

    return true;
  },

  provideEditor: () => undefined,
};

// ---------------------------------------------------------------------------
// TypeDistributionCell — color-segmented bar showing BSON type proportions
// ---------------------------------------------------------------------------

interface TypeDistributionCellData {
  kind: "type-distribution-cell";
  types: Array<{ type: string; percentage: number }>;
}

interface TypeDistributionCell
  extends CustomCell<TypeDistributionCellData> {
  kind: typeof GridCellKind.Custom;
}

const BAR_HEIGHT = 10;
const BAR_PADDING = 8;
const BAR_MAX_WIDTH_RATIO = 0.55; // bar takes up to 55% of cell width
const BAR_RADIUS = 3;
const FALLBACK_COLOR = "#6b7280"; // gray-500

export const TypeDistributionCellRenderer: CustomRenderer<TypeDistributionCell> =
  {
    kind: GridCellKind.Custom,

    isMatch: (cell: CustomCell): cell is TypeDistributionCell => {
      const data = cell.data as Record<string, unknown> | null;
      return Boolean(
        data &&
          typeof data === "object" &&
          data.kind === "type-distribution-cell",
      );
    },

    draw: (args, cell) => {
      const { ctx, rect, theme } = args;
      const { types } = cell.data;

      if (types.length === 0) return true;

      const padding = BAR_PADDING;
      const barMaxWidth = Math.floor(
        (rect.width - padding * 2) * BAR_MAX_WIDTH_RATIO,
      );
      const barY = rect.y + (rect.height - BAR_HEIGHT) / 2;
      const barX = rect.x + padding;

      // Draw segmented bar with rounded ends
      ctx.save();
      ctx.beginPath();
      const fullBarWidth = barMaxWidth;

      // Clip to rounded rect for the whole bar
      ctx.beginPath();
      ctx.moveTo(barX + BAR_RADIUS, barY);
      ctx.lineTo(barX + fullBarWidth - BAR_RADIUS, barY);
      ctx.quadraticCurveTo(
        barX + fullBarWidth,
        barY,
        barX + fullBarWidth,
        barY + BAR_RADIUS,
      );
      ctx.lineTo(barX + fullBarWidth, barY + BAR_HEIGHT - BAR_RADIUS);
      ctx.quadraticCurveTo(
        barX + fullBarWidth,
        barY + BAR_HEIGHT,
        barX + fullBarWidth - BAR_RADIUS,
        barY + BAR_HEIGHT,
      );
      ctx.lineTo(barX + BAR_RADIUS, barY + BAR_HEIGHT);
      ctx.quadraticCurveTo(barX, barY + BAR_HEIGHT, barX, barY + BAR_HEIGHT - BAR_RADIUS);
      ctx.lineTo(barX, barY + BAR_RADIUS);
      ctx.quadraticCurveTo(barX, barY, barX + BAR_RADIUS, barY);
      ctx.closePath();
      ctx.clip();

      // Draw segments
      let segX = barX;
      for (const { type, percentage } of types) {
        const segWidth = Math.max(1, (percentage / 100) * fullBarWidth);
        ctx.fillStyle = BSON_TYPE_COLORS[type] ?? FALLBACK_COLOR;
        ctx.fillRect(segX, barY, segWidth, BAR_HEIGHT);
        segX += segWidth;
      }
      ctx.restore();

      // Draw type labels to the right of the bar
      const labelX = barX + fullBarWidth + 6;
      const maxLabelWidth = rect.x + rect.width - labelX - padding;
      if (maxLabelWidth > 20) {
        ctx.save();
        ctx.font = "11px sans-serif";
        ctx.fillStyle = theme.textMedium;
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        const centerY = rect.y + rect.height / 2;

        const labelParts: string[] = [];
        for (const { type, percentage } of types) {
          labelParts.push(`${type} ${Math.round(percentage)}%`);
        }
        const label = labelParts.join(", ");

        // Truncate if needed
        let displayLabel = label;
        if (ctx.measureText(label).width > maxLabelWidth) {
          while (
            displayLabel.length > 0 &&
            ctx.measureText(displayLabel + "...").width > maxLabelWidth
          ) {
            displayLabel = displayLabel.slice(0, -1);
          }
          displayLabel += "...";
        }

        ctx.fillText(displayLabel, labelX, centerY);
        ctx.restore();
      }

      return true;
    },

    provideEditor: () => undefined,
  };
