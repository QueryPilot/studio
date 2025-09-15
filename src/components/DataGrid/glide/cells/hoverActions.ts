import type { CustomCell, Theme, Rectangle } from "@glideapps/glide-data-grid";

export type HoverIcon =
  | "chevron"
  | "pencil"
  | "copy"
  | "arrow-up-right"
  | "code"
  | "image"
  | "download";

export interface HoverAction {
  id: "edit" | "copy" | "navigate" | "open-json" | "open-image" | "download";
  icon: HoverIcon;
  visible: (cell: CustomCell) => boolean;
  onClick: (cell: CustomCell, coords: { x: number; y: number }) => void;
}

export const HOVER_BUTTON_SIZE = 18;
export const HOVER_BUTTON_SPACING = 4;
export const HOVER_RIGHT_PADDING = 8;

export function getHoverActions(cell: CustomCell): HoverAction[] {
  const kind = (cell.data as { kind?: string }).kind || "";
  const value = (cell.data as { value?: unknown }).value as unknown;
  const meta = (cell.data as { metadata?: Record<string, unknown> })
    .metadata as Record<string, unknown> | undefined;

  const hasValue = value !== null && value !== undefined && value !== "";

  const actions: HoverAction[] = [];

  const addCopy = () =>
    actions.push({
      id: "copy",
      icon: "copy",
      visible: () => hasValue,
      onClick: () => {
        try {
          const text =
            typeof value === "object" && value !== null
              ? JSON.stringify(value as Record<string, unknown>)
              : String(value ?? "");
          void navigator.clipboard.writeText(text);
        } catch {
          /* noop */
        }
      },
    });

  switch (kind) {
    case "boolean-cell":
    case "enum-cell":
    case "date-cell":
    case "datetime-cell":
    case "time-cell":
      actions.push({
        id: "edit",
        icon:
          kind === "boolean-cell" || kind === "enum-cell"
            ? "chevron"
            : "pencil",
        visible: () => true,
        onClick: () => {
          /* handled upstream via F2/double-click */
        },
      });
      addCopy();
      break;
    case "json-cell":
      actions.push({
        id: "open-json",
        icon: "code",
        visible: () => hasValue,
        onClick: () => {
          /* open popup handled upstream */
        },
      });
      addCopy();
      break;
    case "lookup-cell":
      actions.push({
        id: "edit",
        icon: "chevron",
        visible: () => true,
        onClick: () => {},
      });
      addCopy();
      if (meta && (meta as { is_fk?: boolean }).is_fk) {
        actions.push({
          id: "navigate",
          icon: "arrow-up-right",
          visible: () => hasValue,
          onClick: () => {},
        });
      }
      break;
    case "binary-cell":
      actions.push({
        id: "download",
        icon: "download",
        visible: () => hasValue,
        onClick: () => {},
      });
      addCopy();
      break;
    default:
      if (hasValue) addCopy();
      break;
  }

  return actions.filter((a) => a.visible(cell));
}

export function getHoverBandWidth(actionsCount: number): number {
  if (actionsCount <= 0) return 0;
  return (
    actionsCount * HOVER_BUTTON_SIZE +
    (actionsCount - 1) * HOVER_BUTTON_SPACING +
    HOVER_RIGHT_PADDING
  );
}

export function hitTestHoverAction(
  bounds: Rectangle,
  mouseX: number,
  actionsCount: number,
): number | null {
  const bandWidth = getHoverBandWidth(actionsCount);
  const startX = bounds.x + bounds.width - bandWidth + HOVER_RIGHT_PADDING;
  const endX = bounds.x + bounds.width - HOVER_RIGHT_PADDING;
  if (mouseX < startX || mouseX > endX) return null;
  const inside = mouseX - startX;
  const slot = Math.floor(inside / (HOVER_BUTTON_SIZE + HOVER_BUTTON_SPACING));
  return slot >= 0 && slot < actionsCount ? slot : null;
}

export function drawHoverButtons(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  theme: Theme,
  actions: HoverAction[],
  alpha = 0.5,
) {
  if (actions.length === 0) return 0;
  const bandWidth = getHoverBandWidth(actions.length);
  const startX = rect.x + rect.width - bandWidth + HOVER_RIGHT_PADDING;
  let x = startX;
  const y = rect.y + (rect.height - HOVER_BUTTON_SIZE) / 2;

  for (const a of actions) {
    // icon-only (no background to preserve selection visuals)
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = theme.textDark as string;
    ctx.strokeStyle = theme.textDark as string;
    drawIcon(ctx, a.icon, x, y, HOVER_BUTTON_SIZE);
    ctx.restore();
    x += HOVER_BUTTON_SIZE + HOVER_BUTTON_SPACING;
  }
  return bandWidth;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function drawIcon(
  ctx: CanvasRenderingContext2D,
  icon: HoverIcon,
  bx: number,
  by: number,
  size: number,
) {
  const cx = bx + size / 2;
  const cy = by + size / 2;
  const s = size * 0.4;
  ctx.beginPath();
  switch (icon) {
    case "chevron":
      ctx.moveTo(cx - s * 0.6, cy - s * 0.3);
      ctx.lineTo(cx, cy + s * 0.3);
      ctx.lineTo(cx + s * 0.6, cy - s * 0.3);
      ctx.fill();
      break;
    case "pencil":
      ctx.rect(cx - s * 0.6, cy + s * 0.2, s * 1.2, s * 0.2);
      ctx.fill();
      break;
    case "copy":
      ctx.rect(cx - s * 0.6, cy - s * 0.3, s * 0.9, s * 0.8);
      ctx.rect(cx - s * 0.2, cy - s * 0.5, s * 0.9, s * 0.8);
      ctx.fill();
      break;
    case "arrow-up-right":
      ctx.moveTo(cx - s * 0.6, cy + s * 0.5);
      ctx.lineTo(cx + s * 0.6, cy - s * 0.5);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    case "code":
      ctx.moveTo(cx - s * 0.6, cy);
      ctx.lineTo(cx - s * 0.2, cy - s * 0.4);
      ctx.moveTo(cx - s * 0.6, cy);
      ctx.lineTo(cx - s * 0.2, cy + s * 0.4);
      ctx.moveTo(cx + s * 0.6, cy);
      ctx.lineTo(cx + s * 0.2, cy - s * 0.4);
      ctx.moveTo(cx + s * 0.6, cy);
      ctx.lineTo(cx + s * 0.2, cy + s * 0.4);
      ctx.stroke();
      break;
    case "image":
      ctx.rect(cx - s * 0.6, cy - s * 0.4, s * 1.2, s * 0.8);
      ctx.moveTo(cx - s * 0.5, cy + s * 0.2);
      ctx.lineTo(cx - s * 0.1, cy - s * 0.1);
      ctx.lineTo(cx + s * 0.5, cy + s * 0.2);
      ctx.stroke();
      break;
    case "download":
      ctx.moveTo(cx, cy - s * 0.5);
      ctx.lineTo(cx, cy + s * 0.2);
      ctx.lineTo(cx - s * 0.3, cy);
      ctx.moveTo(cx, cy + s * 0.2);
      ctx.lineTo(cx + s * 0.3, cy);
      ctx.moveTo(cx - s * 0.6, cy + s * 0.4);
      ctx.lineTo(cx + s * 0.6, cy + s * 0.4);
      ctx.stroke();
      break;
  }
}
