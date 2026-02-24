import { describe, it, expect, vi } from "vitest";
import { GridCellKind } from "@glideapps/glide-data-grid";
import type { DrawArgs } from "@glideapps/glide-data-grid";
import ExpandableCellRenderer from "../renderer";
import type { ExpandableCustomCell } from "../types";

const createMockCanvas = () => {
  const measureTextResult = { width: 100 };
  return {
    fillText: vi.fn(),
    measureText: vi.fn(() => measureTextResult),
    font: "",
    fillStyle: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "middle" as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D;
};

const createMockTheme = () => ({
  accentColor: "#4F46E5",
  accentLight: "#818CF8",
  accentFg: "#FFFFFF",
  textDark: "#1F2937",
  textMedium: "#6B7280",
  textLight: "#9CA3AF",
  textBubble: "#FFFFFF",
  bgIconHeader: "#F3F4F6",
  fgIconHeader: "#6B7280",
  bgCell: "#FFFFFF",
  bgCellMedium: "#F9FAFB",
  bgHeader: "#F9FAFB",
  bgHeaderHasFocus: "#E5E7EB",
  bgHeaderHovered: "#F3F4F6",
  bgBubble: "#FFFFFF",
  bgBubbleSelected: "#EEF2FF",
  bgSearchResult: "#FEF3C7",
  borderColor: "#E5E7EB",
  drilldownBorder: "#D1D5DB",
  linkColor: "#3B82F6",
  headerFontStyle: "600 12px",
  headerFontFull: "600 12px Inter, system-ui, sans-serif",
  baseFontStyle: "400 12px",
  baseFontFull: "400 12px Inter, system-ui, sans-serif",
  markerFontStyle: "400 10px",
  markerFontFull: "400 10px Inter, system-ui, sans-serif",
  fontFamily: "Inter, system-ui, sans-serif",
  editorFontSize: "12px",
  textHeader: "#374151",
  textGroupHeader: "#6B7280",
  textHeaderSelected: "#1F2937",
  cellHorizontalPadding: 8,
  cellVerticalPadding: 3,
  headerIconSize: 18,
  lineHeight: 1.4,
});

const createCell = (
  value: unknown,
  isExpanded = false,
  readonly = false
): ExpandableCustomCell => ({
  kind: GridCellKind.Custom,
  data: {
    kind: "expandable-cell",
    value,
    isExpanded,
  },
  copyData: JSON.stringify(value),
  allowOverlay: !readonly,
  readonly,
});

const createDrawArgs = (
  cell: ExpandableCustomCell,
  ctx?: CanvasRenderingContext2D
): DrawArgs<ExpandableCustomCell> => ({
  ctx: ctx || createMockCanvas(),
  rect: { x: 0, y: 0, width: 200, height: 32 },
  theme: createMockTheme(),
  col: 0,
  row: 0,
  cell,
  highlighted: false,
  hoverAmount: 0,
  hoverX: undefined,
  hoverY: undefined,
  imageLoader: {
    loadOrGetImage: vi.fn(),
    setWindow: vi.fn(),
    setCallback: vi.fn(),
  },
  requestAnimationFrame: vi.fn(),
  spriteManager: {} as never,
  hyperWrapping: false,
  drawState: ["default", vi.fn()] as any,
  frameTime: 0,
  overrideCursor: undefined,
  cellFillColor: "#FFFFFF",
});

describe("ExpandableCellRenderer", () => {
  describe("isMatch", () => {
    it("should match expandable-cell kind", () => {
      const cell = createCell({ foo: "bar" });
      expect(ExpandableCellRenderer.isMatch(cell)).toBe(true);
    });

    it("should not match other cell kinds", () => {
      const cell = {
        kind: GridCellKind.Custom,
        data: { kind: "json-cell", value: "{}" },
        copyData: "",
        allowOverlay: true,
      } as unknown as ExpandableCustomCell;
      expect(ExpandableCellRenderer.isMatch(cell)).toBe(false);
    });

    it("should not match cells without data", () => {
      const cell = {
        kind: GridCellKind.Text,
        data: "text",
        displayData: "text",
        allowOverlay: true,
      };
      expect(ExpandableCellRenderer.isMatch(cell as never)).toBe(false);
    });
  });

  describe("draw", () => {
    it("should render null values", () => {
      const cell = createCell(null);
      const ctx = createMockCanvas();
      const args = createDrawArgs(cell, ctx);

      const result = ExpandableCellRenderer.draw(args, cell);

      expect(result).toBe(true);
      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringContaining("NULL"),
        expect.any(Number),
        expect.any(Number)
      );
    });

    it("should render undefined values", () => {
      const cell = createCell(undefined);
      const ctx = createMockCanvas();
      const args = createDrawArgs(cell, ctx);

      const result = ExpandableCellRenderer.draw(args, cell);

      expect(result).toBe(true);
      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringContaining("NULL"),
        expect.any(Number),
        expect.any(Number)
      );
    });

    it("should render collapsed arrays with count", () => {
      const cell = createCell([1, 2, 3], false);
      const ctx = createMockCanvas();
      const args = createDrawArgs(cell, ctx);

      ExpandableCellRenderer.draw(args, cell);

      expect(ctx.fillText).toHaveBeenCalledWith(
        "▶",
        expect.any(Number),
        expect.any(Number)
      );
      expect(ctx.fillText).toHaveBeenCalledWith(
        "Array[3]",
        expect.any(Number),
        expect.any(Number)
      );
    });

    it("should render collapsed objects with key count", () => {
      const cell = createCell({ a: 1, b: 2 }, false);
      const ctx = createMockCanvas();
      const args = createDrawArgs(cell, ctx);

      ExpandableCellRenderer.draw(args, cell);

      expect(ctx.fillText).toHaveBeenCalledWith(
        "▶",
        expect.any(Number),
        expect.any(Number)
      );
      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringContaining("Object{2"),
        expect.any(Number),
        expect.any(Number)
      );
    });

    it("should render expanded arrays with JSON", () => {
      const cell = createCell([1, 2, 3], true);
      const ctx = createMockCanvas();
      const args = createDrawArgs(cell, ctx);

      ExpandableCellRenderer.draw(args, cell);

      expect(ctx.fillText).toHaveBeenCalledWith(
        "▼",
        expect.any(Number),
        expect.any(Number)
      );
      // Should show first line of JSON
      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringMatching(/\[/),
        expect.any(Number),
        expect.any(Number)
      );
    });

    it("should render expanded objects with JSON", () => {
      const cell = createCell({ name: "test", value: 42 }, true);
      const ctx = createMockCanvas();
      const args = createDrawArgs(cell, ctx);

      ExpandableCellRenderer.draw(args, cell);

      expect(ctx.fillText).toHaveBeenCalledWith(
        "▼",
        expect.any(Number),
        expect.any(Number)
      );
      // Should show first line of JSON
      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringMatching(/\{/),
        expect.any(Number),
        expect.any(Number)
      );
    });

    it("should not show expand icon for empty arrays", () => {
      const cell = createCell([], false);
      const ctx = createMockCanvas();
      const args = createDrawArgs(cell, ctx);

      ExpandableCellRenderer.draw(args, cell);

      expect(ctx.fillText).not.toHaveBeenCalledWith(
        "▶",
        expect.any(Number),
        expect.any(Number)
      );
    });

    it("should not show expand icon for empty objects", () => {
      const cell = createCell({}, false);
      const ctx = createMockCanvas();
      const args = createDrawArgs(cell, ctx);

      ExpandableCellRenderer.draw(args, cell);

      expect(ctx.fillText).not.toHaveBeenCalledWith(
        "▶",
        expect.any(Number),
        expect.any(Number)
      );
    });
  });

});
