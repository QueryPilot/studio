import { act, renderHook } from "@testing-library/react";
import type {
  DataEditorRef,
  GridMouseEventArgs,
} from "@glideapps/glide-data-grid";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { writeClipboardText } from "@/lib/clipboard";
import type { GridColumnV2, GridRowModel } from "@/components/DataGrid/types";
import { useCellHoverIcons } from "../useCellHoverIcons";

vi.mock("@/lib/clipboard", () => ({
  writeClipboardText: vi.fn(() => Promise.resolve()),
}));

const createMockCanvasContext = (): CanvasRenderingContext2D =>
  ({
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "round",
    lineJoin: "round",
  }) as unknown as CanvasRenderingContext2D;

const columns: GridColumnV2[] = [
  {
    id: "value",
    field: "col_0",
    title: "Value",
    name: "value",
    width: 120,
    type: "text",
    meta: {
      name: "value",
      db_type: "text",
      nullable: true,
      default: null,
      is_pk: false,
      is_fk: false,
      ordinal: 0,
    },
  },
];

const rows: GridRowModel[] = [
  {
    col_0: {
      value: "cell-value",
      db_type: "text",
      value_type: "Text",
      is_truncated: false,
    },
  },
];

describe("useCellHoverIcons copy feedback redraw", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests an immediate redraw when copy icon is clicked", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 400,
        bottom: 300,
        width: 400,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const updateCells = vi.fn();
    const gridRef = {
      current: {
        updateCells,
      } as unknown as DataEditorRef,
    };

    const { result } = renderHook(() =>
      useCellHoverIcons({
        columns,
        rows,
        enabled: true,
        containerRef: {
          current: container,
        } as React.RefObject<HTMLElement | null>,
        gridRef: gridRef as React.RefObject<DataEditorRef | null>,
      }),
    );

    act(() => {
      result.current.onItemHovered({
        kind: "cell",
        location: [0, 0],
      } as unknown as GridMouseEventArgs);
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.hoveredCell).toEqual([0, 0]);

    const drawArgs = {
      ctx: createMockCanvasContext(),
      rect: { x: 10, y: 10, width: 100, height: 28 },
      col: 0,
      row: 0,
      theme: {
        bgCell: "#ffffff",
        borderColor: "#d4d4d8",
        textMedium: "#71717a",
        textDark: "#18181b",
      },
      cellFillColor: "#ffffff",
    } as unknown as Parameters<typeof result.current.drawCell>[0];

    act(() => {
      result.current.drawCell(drawArgs, () => {});
    });

    updateCells.mockClear();

    await act(async () => {
      container.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: 90,
          clientY: 20,
        }),
      );
      await Promise.resolve();
    });

    expect(writeClipboardText).toHaveBeenCalledWith("cell-value");
    expect(updateCells).toHaveBeenCalled();
  });
});
