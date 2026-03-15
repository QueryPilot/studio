import {
  GridCellKind,
  type CustomCell,
  type CustomRenderer,
} from "@glideapps/glide-data-grid";

// ---------------------------------------------------------------------------
// IndexPropertiesCell -- renders property badges (unique, sparse, TTL, text, lang)
// ---------------------------------------------------------------------------

interface IndexPropertiesCellData {
  kind: "index-properties-cell";
  unique: boolean;
  sparse: boolean;
  expireAfterSeconds?: number;
  isTextIndex: boolean;
  language?: string;
}

interface IndexPropertiesCell
  extends CustomCell<IndexPropertiesCellData> {
  kind: typeof GridCellKind.Custom;
}

interface BadgeStyle {
  bg: string;
  fg: string;
}

const UNIQUE_STYLE: BadgeStyle = { bg: "rgba(139, 92, 246, 0.15)", fg: "#7c3aed" }; // purple
const SPARSE_STYLE: BadgeStyle = { bg: "rgba(59, 130, 246, 0.12)", fg: "#3b82f6" }; // blue
const TTL_STYLE: BadgeStyle = { bg: "rgba(245, 158, 11, 0.15)", fg: "#d97706" }; // amber
const TEXT_STYLE: BadgeStyle = { bg: "rgba(34, 197, 94, 0.15)", fg: "#16a34a" }; // green
const LANG_STYLE: BadgeStyle = { bg: "rgba(107, 114, 128, 0.15)", fg: "#6b7280" }; // gray

const BADGE_RADIUS = 3;
const BADGE_H_PAD = 5;
const BADGE_GAP = 4;
const CELL_PAD = 8;

function drawBadge(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  centerY: number,
  style: BadgeStyle,
): number {
  const textWidth = ctx.measureText(label).width;
  const badgeWidth = textWidth + BADGE_H_PAD * 2;
  const badgeHeight = 16;
  const badgeY = centerY - badgeHeight / 2;

  // Background
  ctx.fillStyle = style.bg;
  ctx.beginPath();
  ctx.moveTo(x + BADGE_RADIUS, badgeY);
  ctx.lineTo(x + badgeWidth - BADGE_RADIUS, badgeY);
  ctx.quadraticCurveTo(
    x + badgeWidth,
    badgeY,
    x + badgeWidth,
    badgeY + BADGE_RADIUS,
  );
  ctx.lineTo(x + badgeWidth, badgeY + badgeHeight - BADGE_RADIUS);
  ctx.quadraticCurveTo(
    x + badgeWidth,
    badgeY + badgeHeight,
    x + badgeWidth - BADGE_RADIUS,
    badgeY + badgeHeight,
  );
  ctx.lineTo(x + BADGE_RADIUS, badgeY + badgeHeight);
  ctx.quadraticCurveTo(
    x,
    badgeY + badgeHeight,
    x,
    badgeY + badgeHeight - BADGE_RADIUS,
  );
  ctx.lineTo(x, badgeY + BADGE_RADIUS);
  ctx.quadraticCurveTo(x, badgeY, x + BADGE_RADIUS, badgeY);
  ctx.closePath();
  ctx.fill();

  // Text
  ctx.fillStyle = style.fg;
  ctx.textAlign = "left";
  ctx.fillText(label, x + BADGE_H_PAD, centerY);

  return badgeWidth;
}

export const IndexPropertiesCellRenderer: CustomRenderer<IndexPropertiesCell> = {
  kind: GridCellKind.Custom,

  isMatch: (cell: CustomCell): cell is IndexPropertiesCell => {
    const data = cell.data as Record<string, unknown> | null;
    return Boolean(
      data &&
        typeof data === "object" &&
        data.kind === "index-properties-cell",
    );
  },

  draw: (args, cell) => {
    const { ctx, rect } = args;
    const { unique, sparse, expireAfterSeconds, isTextIndex, language } =
      cell.data;

    const badges: Array<{ label: string; style: BadgeStyle }> = [];
    if (unique) badges.push({ label: "unique", style: UNIQUE_STYLE });
    if (sparse) badges.push({ label: "sparse", style: SPARSE_STYLE });
    if (typeof expireAfterSeconds === "number") {
      badges.push({
        label: `TTL ${String(expireAfterSeconds)}s`,
        style: TTL_STYLE,
      });
    }
    if (isTextIndex) badges.push({ label: "text", style: TEXT_STYLE });
    if (language) badges.push({ label: language, style: LANG_STYLE });

    if (badges.length === 0) return true;

    ctx.save();
    ctx.font = "bold 9px sans-serif";
    ctx.textBaseline = "middle";

    const centerY = rect.y + rect.height / 2;
    let x = rect.x + CELL_PAD;
    const maxX = rect.x + rect.width - CELL_PAD;

    for (const badge of badges) {
      const needed = ctx.measureText(badge.label).width + BADGE_H_PAD * 2;
      if (x + needed > maxX) break;
      const width = drawBadge(ctx, badge.label, x, centerY, badge.style);
      x += width + BADGE_GAP;
    }

    ctx.restore();
    return true;
  },

  provideEditor: () => undefined,
};
