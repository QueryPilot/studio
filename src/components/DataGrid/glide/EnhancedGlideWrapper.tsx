import { memo, useCallback, useState, useRef, useMemo, useEffect } from "react";
import DataEditor, {
  type GridCell,
  type GridColumn,
  type Item,
  type Rectangle,
  type GridSelection,
  GridCellKind,
  type DataEditorRef,
  type Theme,
  type GridMouseEventArgs,
  CompactSelection,
} from "@glideapps/glide-data-grid";
import type { CustomCell } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import "./glide-overrides.css";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useCopy } from "@/hooks/useCopy";
import { useToast } from "@/hooks/use-toast";
import { CellValuePopup } from "./CellValuePopup";
import { useDatabaseCells } from "./cells";
import {
  ChevronDown,
  Clipboard,
  ClipboardCheck,
  ArrowUpRight,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command as CommandRoot,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import {
  Copy,
  FileJson,
  Table,
  Search,
  Filter,
  SortAsc,
  SortDesc,
  Eye,
} from "lucide-react";

const pad2 = (value: number): string => value.toString().padStart(2, "0");

const formatDatePart = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const formatTimePart = (date: Date): string =>
  `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds(),
  )}`;

const parseDateValue = (value: unknown): Date | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const normalized =
      trimmed.includes(" ") && !trimmed.includes("T")
        ? trimmed.replace(" ", "T")
        : trimmed;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
};

const parseTimeParts = (
  value: unknown,
): { hours: number; minutes: number; seconds: number } | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      hours: value.getHours(),
      minutes: value.getMinutes(),
      seconds: value.getSeconds(),
    };
  }
  if (typeof value === "string") {
    const match = value.match(/(?:^|T|\s)(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      return {
        hours: Number(match[1]),
        minutes: Number(match[2]),
        seconds: Number(match[3] ?? "0"),
      };
    }
  }
  return null;
};

const applyTimeParts = (
  date: Date,
  parts: { hours: number; minutes: number; seconds: number },
  useUTC = false,
) => {
  if (useUTC) {
    date.setUTCHours(parts.hours, parts.minutes, parts.seconds, 0);
  } else {
    date.setHours(parts.hours, parts.minutes, parts.seconds, 0);
  }
};

interface EnhancedGlideWrapperProps {
  columns: GridColumn[];
  rows: number;
  getCellContent: (cell: Item) => GridCell;
  getCellValue?: (cell: Item) => unknown;
  onCellClicked?: (cell: Item) => void;
  onCellDoubleClick?: (cell: Item) => void;
  onCellEdited?: (cell: Item, newValue: GridCell) => void;
  onColumnResize?: (
    column: GridColumn,
    newSize: number,
    colIndex: number,
  ) => void;
  onColumnResizeEnd?: (
    column: GridColumn,
    newSize: number,
    colIndex: number,
  ) => void;
  onColumnMoved?: (startIndex: number, endIndex: number) => void;
  onRowAppended?: () => void;
  onVisibleRegionChanged?: (range: Rectangle) => void;
  onSelectionChange?: (selectedRowCount: number) => void;
  className?: string;
  freezeColumns?: number;
  rowMarkers?: "none" | "number" | "checkbox" | "both";
  headerHeight?: number;
  rowHeight?: number;
  isLoading?: boolean;
  isLoadingMore?: boolean;
  estimatedTotal?: number;
}

export const EnhancedGlideWrapper = memo(function EnhancedGlideWrapper({
  columns,
  rows,
  getCellContent,
  getCellValue,
  onCellClicked,
  onCellDoubleClick,
  onCellEdited,
  onColumnResize,
  onColumnResizeEnd,
  onColumnMoved,
  onRowAppended,
  onVisibleRegionChanged,
  onSelectionChange,
  className,
  freezeColumns = 0,
  rowMarkers = "none",
  headerHeight = 28,
  rowHeight = 28,
  isLoading = false,
  isLoadingMore = false,
  estimatedTotal,
}: EnhancedGlideWrapperProps) {
  const { theme: appTheme } = useTheme();
  const { customRenderers } = useDatabaseCells();

  // Note: custom draw override intentionally disabled for now; rely on default renderer
  const { copy } = useCopy();
  const { toast } = useToast();
  const gridRef = useRef<DataEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollOptimizationRef = useRef<{
    lastScroll: number;
    rafId: number | null;
  }>({
    lastScroll: 0,
    rafId: null,
  });
  const overlayHoverRef = useRef<boolean>(false);
  const hoverHoldUntilRef = useRef<number>(0);
  const hoverHideTimerRef = useRef<number | null>(null);
  const [inlineEditor, setInlineEditor] = useState<{
    cell: Item;
    bounds: Rectangle;
    kind: string;
    meta?: Record<string, unknown>;
    value: unknown;
  } | null>(null);
  const inlineEditorRef = useRef<HTMLDivElement>(null);

  const inlineEditorPosition = useMemo(() => {
    if (!inlineEditor) return null;
    const { bounds, kind } = inlineEditor;

    const containerRect = containerRef.current?.getBoundingClientRect();
    const viewportWidth =
      typeof window !== "undefined" ? window.innerWidth : undefined;
    const viewportHeight =
      typeof window !== "undefined" ? window.innerHeight : undefined;

    const baseWidth = Math.max(
      bounds.width,
      (() => {
        switch (kind) {
          case "json-cell":
            return 420;
          case "date-cell":
          case "datetime-cell":
            return 280;
          case "enum-cell":
            return 220;
          case "boolean-cell":
            return 180;
          case "time-cell":
            return 200;
          default:
            return 220;
        }
      })(),
    );

    const estimatedHeight = (() => {
      switch (kind) {
        case "json-cell":
          return 360;
        case "date-cell":
        case "datetime-cell":
          return 320;
        case "enum-cell":
          return 220;
        case "boolean-cell":
          return 180;
        case "time-cell":
          return 160;
        default:
          return 200;
      }
    })();

    const padding = 16;

    let left = (containerRect?.left ?? 0) + bounds.x;
    if (viewportWidth) {
      const maxLeft = viewportWidth - padding - baseWidth;
      left = Math.min(Math.max(padding, left), Math.max(padding, maxLeft));
    }

    let top = (containerRect?.top ?? 0) + bounds.y + bounds.height + 8;
    if (viewportHeight) {
      const maxTop = viewportHeight - padding - estimatedHeight;
      if (top > maxTop) {
        top = Math.max(
          padding,
          (containerRect?.top ?? 0) + bounds.y - estimatedHeight - 8,
        );
      }
    }

    return {
      left,
      top,
      minWidth: baseWidth,
    };
  }, [inlineEditor]);

  const inlineEditorDateValue = useMemo(
    () => parseDateValue(inlineEditor?.value),
    [inlineEditor],
  );

  const inlineEditorTimeParts = useMemo(
    () => parseTimeParts(inlineEditor?.value),
    [inlineEditor],
  );

  type DbCellData = {
    kind?: string;
    value?: unknown;
    metadata?: Record<string, unknown>;
  };

  const isCustomCell = useCallback(
    (c: GridCell): c is CustomCell<DbCellData> =>
      c.kind === GridCellKind.Custom,
    [],
  );

  const [gridSelection, setGridSelection] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  });

  const [popupState, setPopupState] = useState<{
    isOpen: boolean;
    value: unknown;
    columnName: string;
    rowIndex: number;
  }>({
    isOpen: false,
    value: null,
    columnName: "",
    rowIndex: 0,
  });

  const [contextMenuState, setContextMenuState] = useState<{
    cell: Item | null;
    position: { x: number; y: number } | null;
  }>({
    cell: null,
    position: null,
  });

  type HoverAction = {
    id: "edit" | "copy" | "navigate";
    icon: "chevron" | "clipboard" | "arrow-up-right";
    state?: "success";
  };
  const [hoverUi, setHoverUi] = useState<{
    bounds: Rectangle;
    cell: Item;
    actions: HoverAction[];
    side: "left" | "right";
    offsetPx?: number;
  } | null>(null);

  // Create theme based on app theme matching our color system
  const theme = useMemo<Partial<Theme>>(() => {
    const isDark = appTheme === "dark";

    return {
      // Accent colors using our brand colors
      accentColor: "#FCA311", // Primary brand color
      accentLight: "rgba(252, 163, 17, 0.1)",
      accentFg: "#09090B",

      // Text colors matching our theme
      textDark: isDark ? "#AEACA8" : "#09090B",
      textMedium: isDark ? "rgba(229, 229, 229, 0.7)" : "rgba(0, 0, 0, 0.7)",
      textLight: isDark ? "rgba(229, 229, 229, 0.5)" : "rgba(0, 0, 0, 0.5)",
      textBubble: isDark ? "#AEACA8" : "#09090B",

      // Header colors
      bgIconHeader: isDark ? "#14213D" : "#F5F5F5",
      fgIconHeader: isDark ? "#D1D5DB" : "#111827",
      textHeader: isDark ? "#D1D5DB" : "#111827",
      textHeaderSelected: isDark ? "#F3F4F6" : "#111827",
      bgHeaderSelected: "transparent",

      // Cell backgrounds matching our surface colors
      bgCell: isDark ? "#09090B" : "#FFFFFF",
      bgCellMedium: isDark ? "#0A0A0A" : "#FAFAFA",
      bgHeader: isDark ? "#1C1C21" : "#F5F5F5",
      bgHeaderHasFocus: isDark ? "#1C1C21" : "#F5F5F5",
      bgHeaderHovered: isDark ? "#2A2A30" : "#E8E8E8",

      // Other backgrounds
      bgBubble: isDark ? "#14213D" : "#F5F5F5",
      bgBubbleSelected: "#FCA311",

      // Row selection highlight
      bgCellSelected: isDark
        ? "rgba(252, 163, 17, 0.1)"
        : "rgba(252, 163, 17, 0.05)",
      bgCellSelectedMedium: isDark
        ? "rgba(252, 163, 17, 0.15)"
        : "rgba(252, 163, 17, 0.08)",

      bgSearchResult: "rgba(252, 163, 17, 0.2)",

      // Borders
      borderColor: isDark ? "rgba(229, 229, 229, 0.1)" : "rgba(0, 0, 0, 0.1)",
      horizontalBorderColor: isDark
        ? "rgba(229, 229, 229, 0.05)"
        : "rgba(0, 0, 0, 0.05)",
      drilldownBorder: isDark
        ? "rgba(229, 229, 229, 0.2)"
        : "rgba(0, 0, 0, 0.2)",

      linkColor: "#FCA311",

      cellHorizontalPadding: 8,
      cellVerticalPadding: 4,

      headerFontStyle: "600 12px",
      baseFontStyle: "400 12px",
      editorFontSize: "12px",
      lineHeight: 1.5,

      fontFamily: [
        "Noto Sans",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Helvetica",
        "Arial",
        "sans-serif",
      ].join(", "),
    };
  }, [appTheme]);

  // Handle selection change - auto-select row when cell is selected
  const handleSelectionChange = useCallback(
    (newSelection: GridSelection | undefined) => {
      if (newSelection) {
        let updatedRowSelection = CompactSelection.empty();

        // Check for range selection (when dragging)
        if (newSelection.current?.range) {
          // Range selection - add all rows in the range
          const range = newSelection.current.range;
          for (let row = range.y; row < range.y + range.height; row++) {
            updatedRowSelection = updatedRowSelection.add(row);
          }
        } else if (newSelection.current?.cell) {
          // Single cell selection
          const rowIndex = newSelection.current.cell[1];
          updatedRowSelection = updatedRowSelection.add(rowIndex);
        }

        const updatedSelection = {
          ...newSelection,
          rows: updatedRowSelection,
        };
        setGridSelection(updatedSelection);

        // Notify parent of selection count change
        const selectedCount = updatedRowSelection.length;
        onSelectionChange?.(selectedCount);
      }
    },
    [onSelectionChange],
  );

  // (removed placeholder)

  // Handle cell click (hover actions handled by HTML overlay)
  const handleCellClick = useCallback(
    (cell: Item, _event: GridMouseEventArgs) => {
      onCellClicked?.(cell);
    },
    [onCellClicked],
  );

  // Get cells for selection (copy operation)
  const getCellsForSelection = useCallback(
    (selection: Rectangle): (readonly GridCell[])[] => {
      const result: GridCell[][] = [];

      for (let y = selection.y; y < selection.y + selection.height; y++) {
        const row: GridCell[] = [];
        for (let x = selection.x; x < selection.x + selection.width; x++) {
          row.push(getCellContent([x, y]));
        }
        result.push(row);
      }

      return result;
    },
    [getCellContent],
  );

  // Format cells as CSV
  const formatCellsAsCsv = useCallback((cells: (readonly GridCell[])[]) => {
    return cells
      .map((row) =>
        row
          .map((cell) => {
            const cellAny = cell as unknown as {
              displayData?: unknown;
              data?: unknown;
            };
            const raw = cellAny.displayData ?? cellAny.data;
            const value =
              raw == null
                ? ""
                : typeof raw === "string"
                ? raw
                : JSON.stringify(raw);
            if (
              value.includes(",") ||
              value.includes('"') ||
              value.includes("\n")
            ) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          })
          .join(","),
      )
      .join("\n");
  }, []);

  // Format cells as JSON
  const formatCellsAsJson = useCallback((cells: (readonly GridCell[])[]) => {
    const data = cells.map((row) =>
      row.map((cell) => (cell as { data?: unknown }).data ?? null),
    );
    return JSON.stringify(data, null, 2);
  }, []);

  // Handle copy with format
  const handleCopyWithFormat = useCallback(
    (format: "text" | "csv" | "json") => {
      // Get the current selection
      const selection = gridSelection;
      const selectedRows = selection.rows.toArray();
      if (selectedRows.length === 0) {
        toast({
          title: "No selection",
          description: "Please select cells to copy",
        });
        return;
      }

      // Get selected bounds
      const selectedCols = selection.columns.toArray();

      // If no columns selected, select all
      const cols =
        selectedCols.length > 0 ? selectedCols : columns.map((_, i) => i);

      // Get cells for selection
      const cells: GridCell[][] = [];
      for (const row of selectedRows) {
        const rowCells: GridCell[] = [];
        for (const col of cols) {
          rowCells.push(getCellContent([col, row]));
        }
        cells.push(rowCells);
      }

      let content: string;

      switch (format) {
        case "csv":
          content = formatCellsAsCsv(cells);
          break;
        case "json":
          content = formatCellsAsJson(cells);
          break;
        default:
          content = cells
            .map((row) =>
              row
                .map((cell) => {
                  const c = cell as { displayData?: unknown; data?: unknown };
                  const raw = c.displayData ?? c.data;
                  return raw == null
                    ? ""
                    : typeof raw === "string"
                    ? raw
                    : JSON.stringify(raw);
                })
                .join("\t"),
            )
            .join("\n");
      }

      void copy(content);
      toast({
        title: "Copied to clipboard",
        description: `Selection copied as ${format.toUpperCase()}`,
      });
    },
    [
      gridSelection,
      columns,
      getCellContent,
      formatCellsAsCsv,
      formatCellsAsJson,
      copy,
      toast,
    ],
  );

  // Handle paste operation
  const onPaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]): boolean => {
      if (!onCellEdited) return false;

      // For now, just paste the first value to the target cell
      if (values.length > 0 && values[0] && values[0].length > 0) {
        const newCell = getCellContent(target);
        if (newCell.kind === GridCellKind.Text) {
          onCellEdited(target, {
            ...newCell,
            data: values[0][0] ?? "",
          } as GridCell);
          return true;
        }
      }
      return false;
    },
    [getCellContent, onCellEdited],
  );

  // Handle context menu
  const onCellContextMenu = useCallback(
    (cell: Item, event: GridMouseEventArgs) => {
      if ("bounds" in event) {
        setContextMenuState({
          cell,
          position: { x: event.bounds.x, y: event.bounds.y },
        });
      }
    },
    [],
  );

  // Handle visible region change with optimization
  const handleVisibleRegionChanged = useCallback(
    (range: Rectangle, _tx: number, _ty: number) => {
      const now = performance.now();

      // Throttle updates to 60fps
      const state = scrollOptimizationRef.current;
      if (now - state.lastScroll < 16) {
        return;
      }

      state.lastScroll = now;

      // Cancel previous RAF if exists
      if (state.rafId) {
        cancelAnimationFrame(state.rafId);
      }

      // Use RAF for smooth updates
      state.rafId = requestAnimationFrame(() => {
        onVisibleRegionChanged?.(range);
        // hide hover UI on scroll
        if (hoverUi) setHoverUi(null);
      });
    },
    [onVisibleRegionChanged, hoverUi],
  );

  const formatCellForCopy = useCallback((cell: GridCell): string => {
    const c = cell as unknown as { data?: unknown; displayData?: unknown };
    let raw: unknown = c.data;
    if (cell.kind === GridCellKind.Custom) {
      const d = c.data as { value?: unknown } | undefined;
      if (d && typeof d === "object" && "value" in d) raw = d.value;
    }
    if (raw == null) raw = c.displayData;
    if (raw == null) return "";
    if (typeof raw === "string") return raw;
    try {
      return JSON.stringify(raw as Record<string, unknown>);
    } catch {
      return "[object]";
    }
  }, []);

  const buildHoverActions = useCallback(
    (cell: GridCell): HoverAction[] => {
      const actions: HoverAction[] = [];
      const canCopy = formatCellForCopy(cell).length > 0;
      if (canCopy) actions.push({ id: "copy", icon: "clipboard" });
      if (cell.kind === GridCellKind.Custom)
        actions.push({ id: "edit", icon: "chevron" });
      const meta = (
        cell as unknown as { data?: { metadata?: { is_fk?: boolean } } }
      ).data?.metadata;
      if (meta?.is_fk) actions.push({ id: "navigate", icon: "arrow-up-right" });
      return actions;
    },
    [formatCellForCopy],
  );

  const getOverlaySide = useCallback(
    (cell: GridCell, column: GridColumn | undefined): "left" | "right" => {
      const align = (cell as unknown as { contentAlign?: "left" | "right" })
        .contentAlign;
      if (align === "right") return "left";
      if (cell.kind === GridCellKind.Number) return "left";
      if (cell.kind === GridCellKind.Custom) {
        const k =
          (cell as unknown as { data?: { kind?: string } }).data?.kind ?? "";
        if (k === "number-cell" || k === "money-cell") return "left";
      }
      const t =
        (column as { type?: string } | undefined)?.type?.toLowerCase() ?? "";
      if (/int|numeric|decimal|float|double|real|money/.test(t)) return "left";
      return "right";
    },
    [],
  );

  const getOverlayOffsetPx = useCallback((cell: GridCell): number => {
    if (cell.kind === GridCellKind.Custom) {
      const k = (cell as unknown as { data?: { kind?: string } }).data?.kind;
      if (k === "enum-cell") return 16; // space for chevron glyph
    }
    return 0;
  }, []);

  // Inline editor open helper
  const openInlineEditor = useCallback(
    (cell: Item, bounds: Rectangle) => {
      const gc = getCellContent(cell);
      if (isCustomCell(gc)) {
        const data = gc.data as DbCellData | undefined;
        const kind = (data?.kind as string) || "";
        if (
          kind === "boolean-cell" ||
          kind === "enum-cell" ||
          kind === "date-cell" ||
          kind === "datetime-cell" ||
          kind === "time-cell" ||
          kind === "json-cell"
        ) {
          setInlineEditor({
            cell,
            bounds,
            kind,
            meta: data?.metadata || {},
            value: data?.value,
          });
          return;
        }
      } else {
        // Enable basic editors for default Glide kinds to avoid no-op on double click
        if (gc.kind === GridCellKind.Text) {
          const txt =
            (gc as unknown as { data?: string; displayData?: string }).data ??
            (gc as unknown as { displayData?: string }).displayData ??
            "";
          setInlineEditor({ cell, bounds, kind: "text", value: txt });
          return;
        }
        if (gc.kind === GridCellKind.Number) {
          const num = (gc as unknown as { data?: number }).data ?? 0;
          setInlineEditor({ cell, bounds, kind: "number", value: num });
          return;
        }
        if (gc.kind === GridCellKind.Boolean) {
          const val = (gc as unknown as { data?: boolean }).data ?? false;
          setInlineEditor({ cell, bounds, kind: "boolean-cell", value: val });
          return;
        }
      }
    },
    [getCellContent, isCustomCell],
  );

  // Double click -> open inline editor
  const handleCellDoubleClick = useCallback(
    (cell: Item) => {
      const [col, row] = cell;
      if (col < 0 || row < 0 || col >= columns.length || row >= rows) {
        onCellDoubleClick?.(cell);
        return;
      }
      const getter = gridRef.current?.getBounds;
      if (typeof getter === "function") {
        try {
          const bounds = (
            getter as unknown as (arg: Item) => Rectangle | undefined
          )(cell);
          if (bounds) {
            setTimeout(() => {
              openInlineEditor(cell, bounds);
            }, 0);
            return;
          }
        } catch {
          // ignore and let default handler run
        }
      }
      onCellDoubleClick?.(cell);
    },
    [columns.length, rows, onCellDoubleClick, openInlineEditor],
  );

  // Hover tracking for HTML overlay buttons
  const handleItemHovered = useCallback(
    (
      args: { kind?: string; location?: Item; bounds?: Rectangle } | undefined,
    ) => {
      const a = args;
      const nowTs = performance.now();
      if (
        a == null ||
        a.kind !== "cell" ||
        a.location == null ||
        a.bounds == null
      ) {
        // During hold window, ignore transient non-cell hover events
        if (nowTs < hoverHoldUntilRef.current) return;
        setHoverUi(null);
        return;
      }
      const gc = getCellContent(a.location);
      const actions = buildHoverActions(gc);
      if (actions.length === 0) {
        setHoverUi(null);
        return;
      }
      const side = getOverlaySide(gc, columns[a.location[0]]);
      const offsetPx = getOverlayOffsetPx(gc);
      setHoverUi({
        bounds: a.bounds,
        cell: a.location,
        actions,
        side,
        offsetPx,
      });
    },
    [
      getCellContent,
      buildHoverActions,
      getOverlaySide,
      getOverlayOffsetPx,
      columns,
    ],
  );

  const commitInlineEdit = useCallback(
    (newValue: unknown) => {
      if (!inlineEditor) return;
      const gc = getCellContent(inlineEditor.cell);
      if (isCustomCell(gc)) {
        let normalizedValue = newValue;

        if (inlineEditor.kind === "date-cell") {
          if (newValue instanceof Date && !Number.isNaN(newValue.getTime())) {
            normalizedValue = formatDatePart(newValue);
          } else if (newValue == null || newValue === "") {
            normalizedValue = null;
          } else if (typeof newValue === "string") {
            normalizedValue = newValue;
          }
        } else if (inlineEditor.kind === "datetime-cell") {
          if (newValue instanceof Date && !Number.isNaN(newValue.getTime())) {
            const meta = inlineEditor.meta as { db_type?: string } | undefined;
            const dbType = meta?.db_type?.toLowerCase() ?? "";
            const timeParts = inlineEditorTimeParts;
            if (timeParts) {
              applyTimeParts(
                newValue,
                timeParts,
                dbType.includes("timestamptz"),
              );
            }
            if (dbType.includes("timestamptz")) {
              normalizedValue = newValue.toISOString();
            } else {
              normalizedValue = `${formatDatePart(newValue)} ${formatTimePart(
                newValue,
              )}`;
            }
          } else if (newValue == null || newValue === "") {
            normalizedValue = null;
          } else if (typeof newValue === "string") {
            normalizedValue = newValue;
          }
        } else if (inlineEditor.kind === "time-cell") {
          if (newValue instanceof Date && !Number.isNaN(newValue.getTime())) {
            normalizedValue = newValue.toTimeString().slice(0, 8);
          } else if (typeof newValue === "string") {
            normalizedValue = newValue;
          } else if (newValue == null || newValue === "") {
            normalizedValue = null;
          }
        }

        const updated: GridCell = {
          ...gc,
          data: {
            ...(gc.data as Record<string, unknown>),
            value: normalizedValue,
          },
        } as GridCell;
        onCellEdited?.(inlineEditor.cell, updated);
      } else {
        if (gc.kind === GridCellKind.Text) {
          const text =
            typeof newValue === "string"
              ? newValue
              : newValue == null
              ? ""
              : JSON.stringify(newValue);
          const updated: GridCell = {
            ...gc,
            data: text,
            displayData: text,
          } as GridCell;
          onCellEdited?.(inlineEditor.cell, updated);
        } else if (gc.kind === GridCellKind.Number) {
          const num =
            newValue === "" || newValue == null ? 0 : Number(newValue);
          const updated: GridCell = {
            ...gc,
            data: num,
            displayData: String(num),
          } as GridCell;
          onCellEdited?.(inlineEditor.cell, updated);
        } else if (gc.kind === GridCellKind.Boolean) {
          const bool = Boolean(newValue);
          const updated: GridCell = { ...gc, data: bool } as GridCell;
          onCellEdited?.(inlineEditor.cell, updated);
        }
      }
      setInlineEditor(null);
    },
    [
      inlineEditor,
      inlineEditorTimeParts,
      getCellContent,
      onCellEdited,
      isCustomCell,
    ],
  );

  const cancelInlineEdit = useCallback(() => {
    setInlineEditor(null);
  }, []);

  useEffect(() => {
    if (!inlineEditor) return;
    const handler = (e: MouseEvent) => {
      const el = inlineEditorRef.current;
      if (el && !el.contains(e.target as Node)) {
        setInlineEditor(null);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => {
      document.removeEventListener("mousedown", handler, true);
    };
  }, [inlineEditor]);

  // Cleanup RAF on unmount
  useEffect(() => {
    const current = scrollOptimizationRef.current;
    return () => {
      if (current.rafId) {
        cancelAnimationFrame(current.rafId);
      }
    };
  }, []);

  // Show full loading screen only for initial load (when no data exists)
  if (isLoading && rows === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-full w-full",
          className,
        )}
      >
        <div className="text-muted-foreground">
          Loading data...
          {estimatedTotal && (
            <div className="text-xs mt-1">
              Estimated {estimatedTotal.toLocaleString()} rows
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Absolute overlay container for React hover buttons */}
      <div
        id="glide-html-overlays"
        className="pointer-events-none absolute inset-0 z-10"
      />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={containerRef}
            className={cn("glide-data-grid-wrapper relative w-full", className)}
            style={{
              height: "100%",
              contain: "paint layout",
              willChange: "transform",
              transform: "translateZ(0)", // Force GPU acceleration
            }}
          >
            <DataEditor
              ref={gridRef}
              columns={columns}
              rows={rows}
              getCellContent={getCellContent}
              customRenderers={customRenderers}
              onCellClicked={handleCellClick}
              onCellActivated={handleCellDoubleClick}
              onItemHovered={
                handleItemHovered as unknown as (args: unknown) => void
              }
              onCellEdited={onCellEdited}
              onColumnResize={onColumnResize}
              onColumnResizeEnd={onColumnResizeEnd}
              onColumnMoved={onColumnMoved}
              onHeaderMenuClick={(col, bounds) => {
                // Handle header menu if needed
                console.log("Header menu clicked", col, bounds);
              }}
              onRowAppended={onRowAppended}
              getCellsForSelection={getCellsForSelection}
              onPaste={onPaste}
              onCellContextMenu={onCellContextMenu}
              onVisibleRegionChanged={handleVisibleRegionChanged}
              gridSelection={gridSelection}
              onGridSelectionChange={handleSelectionChange}
              theme={theme}
              width="100%"
              height="100%"
              showSearch={false}
              searchResults={[]}
              freezeColumns={freezeColumns}
              smoothScrollX={true}
              smoothScrollY={true}
              rowMarkers={rowMarkers}
              headerHeight={headerHeight}
              rowHeight={rowHeight}
              // drawCell={drawTextCell} // Disabled - custom renderer breaks text display
              overscrollX={0}
              overscrollY={0}
              rangeSelect="rect"
              columnSelect="single"
              rowSelect="multi"
              fillHandle={false}
              maxColumnWidth={800}
              minColumnWidth={50}
              // getCellsForSelection
              // experimental={
              //   {
              //     renderStrategy: "single-pass",
              //   } as any
              // }
              keybindings={{
                search: false,
                downFill: false,
                rightFill: false,
                pageUp: true,
                pageDown: true,
                clear: false,
                copy: true,
                paste: false,
                selectAll: true,
                selectColumn: true,
                selectRow: true,
              }}
            />
            {hoverUi && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left:
                    hoverUi.bounds.x -
                    (containerRef.current?.getBoundingClientRect().x ?? 0),
                  top:
                    hoverUi.bounds.y -
                    (containerRef.current?.getBoundingClientRect().y ?? 0),
                  width: hoverUi.bounds.width,
                  height: hoverUi.bounds.height,
                }}
              >
                <div
                  className="absolute top-1/2 -translate-y-1/2 flex gap-[2px]"
                  style={{
                    pointerEvents: "auto",
                    right:
                      hoverUi.side === "right"
                        ? (hoverUi.offsetPx ?? 0) + 4
                        : undefined,
                    left:
                      hoverUi.side === "left"
                        ? (hoverUi.offsetPx ?? 0) + 4
                        : undefined,
                  }}
                  onMouseEnter={() => {
                    overlayHoverRef.current = true;
                    if (hoverHideTimerRef.current != null) {
                      window.clearTimeout(hoverHideTimerRef.current);
                      hoverHideTimerRef.current = null;
                    }
                  }}
                  onMouseLeave={() => {
                    overlayHoverRef.current = false;
                    const prevCell = hoverUi.cell;
                    // Add a small grace window to avoid clearing a freshly opened overlay
                    hoverHoldUntilRef.current = performance.now() + 140;
                    if (hoverHideTimerRef.current != null) {
                      window.clearTimeout(hoverHideTimerRef.current);
                      hoverHideTimerRef.current = null;
                    }
                    hoverHideTimerRef.current = window.setTimeout(() => {
                      setHoverUi((current) => {
                        if (overlayHoverRef.current) return current;
                        if (!current) return current;
                        // Only clear if we are still on the same cell we left
                        if (
                          current.cell[0] !== prevCell[0] ||
                          current.cell[1] !== prevCell[1]
                        )
                          return current;
                        return null;
                      });
                      hoverHideTimerRef.current = null;
                    }, 80);
                  }}
                >
                  {hoverUi.actions.map((a, i) => {
                    return (
                      <button
                        key={`${a.id}-${i}`}
                        className="bg-background rounded-md h-5 w-5 flex items-center justify-center shadow-sm hover:bg-accent dark:border"
                        onMouseDown={(e) => {
                          e.preventDefault();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const gc = getCellContent(hoverUi.cell);
                          if (a.id === "edit") {
                            // open inline editor based on cell kind
                            openInlineEditor(hoverUi.cell, hoverUi.bounds);
                          } else if (a.id === "copy") {
                            const txt = formatCellForCopy(gc);
                            void navigator.clipboard.writeText(txt);
                            // Hold briefly to avoid flicker while moving to adjacent cells
                            hoverHoldUntilRef.current = performance.now() + 220;
                            setHoverUi((prev) => {
                              if (!prev) return prev;
                              if (
                                prev.cell[0] !== hoverUi.cell[0] ||
                                prev.cell[1] !== hoverUi.cell[1]
                              )
                                return prev;
                              return {
                                ...prev,
                                actions: prev.actions.map((act, idx) =>
                                  idx === i
                                    ? { ...act, state: "success" }
                                    : act,
                                ),
                              };
                            });
                            window.setTimeout(() => {
                              setHoverUi((prev) => {
                                if (!prev) return prev;
                                return {
                                  ...prev,
                                  actions: prev.actions.map((act, idx) =>
                                    idx === i
                                      ? { ...act, state: undefined }
                                      : act,
                                  ),
                                };
                              });
                            }, 1200);
                          }
                          // keep overlay visible while interacting
                        }}
                        title={a.id}
                      >
                        {(() => {
                          switch (a.icon) {
                            case "chevron":
                              return <ChevronDown className="h-3.5 w-3.5" />;
                            case "clipboard":
                              return a.state === "success" ? (
                                <ClipboardCheck className="h-3.5 w-3.5 text-green-600" />
                              ) : (
                                <Clipboard className="h-3.5 w-3.5" />
                              );
                            case "arrow-up-right":
                              return <ArrowUpRight className="h-3.5 w-3.5" />;
                            default:
                              return null;
                          }
                        })()}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {inlineEditor && (
              <div
                className="pointer-events-auto"
                style={{
                  position: "fixed",
                  left: inlineEditorPosition?.left ?? 0,
                  top: inlineEditorPosition?.top ?? 0,
                  zIndex: 9999,
                  minWidth: inlineEditorPosition?.minWidth,
                  maxWidth: "calc(100vw - 32px)",
                }}
                ref={inlineEditorRef}
              >
                {inlineEditor.kind === "text" && (
                  <div className="bg-popover border rounded-md shadow-md p-2">
                    <input
                      type="text"
                      className="h-8 text-xs rounded-md border bg-background px-2 min-w-[220px]"
                      defaultValue={
                        typeof inlineEditor.value === "string"
                          ? inlineEditor.value
                          : inlineEditor.value == null
                          ? ""
                          : JSON.stringify(inlineEditor.value)
                      }
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          commitInlineEdit(
                            (e.target as HTMLInputElement).value,
                          );
                        } else if (e.key === "Escape") {
                          cancelInlineEdit();
                        }
                      }}
                      onBlur={(e) => {
                        commitInlineEdit(e.target.value);
                      }}
                    />
                  </div>
                )}
                {inlineEditor.kind === "number" && (
                  <div className="bg-popover border rounded-md shadow-md p-2">
                    <input
                      type="number"
                      className="h-8 text-xs rounded-md border bg-background px-2 min-w-[140px] text-right"
                      defaultValue={
                        typeof inlineEditor.value === "number"
                          ? String(inlineEditor.value)
                          : inlineEditor.value == null
                          ? "0"
                          : String(Number(inlineEditor.value) || 0)
                      }
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          commitInlineEdit(
                            (e.target as HTMLInputElement).value,
                          );
                        } else if (e.key === "Escape") {
                          cancelInlineEdit();
                        }
                      }}
                      onBlur={(e) => {
                        commitInlineEdit(e.target.value);
                      }}
                    />
                  </div>
                )}
                {inlineEditor.kind === "boolean-cell" && (
                  <div className="p-1 min-w-[160px] bg-popover border rounded-md shadow-md">
                    <Select
                      defaultValue={
                        inlineEditor.value === null
                          ? "null"
                          : String(Boolean(inlineEditor.value))
                      }
                      onValueChange={(v: string) => {
                        commitInlineEdit(v === "null" ? null : v === "true");
                      }}
                    >
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">TRUE</SelectItem>
                        <SelectItem value="false">FALSE</SelectItem>
                        <SelectItem value="null">NULL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {inlineEditor.kind === "enum-cell" &&
                  (() => {
                    const opts =
                      (
                        inlineEditor.meta as
                          | { enum_values?: string[] }
                          | undefined
                      )?.enum_values ?? [];
                    if (opts.length > 10) {
                      return (
                        <div className="bg-popover border rounded-md shadow-md">
                          <CommandRoot className="min-w-[220px]">
                            <CommandInput placeholder="Search option..." />
                            <CommandList>
                              <CommandEmpty>No results</CommandEmpty>
                              {opts.map((o) => (
                                <CommandItem
                                  key={o}
                                  value={o}
                                  onSelect={(v) => {
                                    commitInlineEdit(v);
                                  }}
                                >
                                  {o}
                                </CommandItem>
                              ))}
                            </CommandList>
                          </CommandRoot>
                        </div>
                      );
                    }
                    return (
                      <div className="p-1 min-w-[180px] bg-popover border rounded-md shadow-md">
                        <Select
                          defaultValue={
                            typeof inlineEditor.value === "string"
                              ? inlineEditor.value
                              : ""
                          }
                          onValueChange={(v: string) => {
                            commitInlineEdit(v);
                          }}
                        >
                          <SelectTrigger className="h-8 w-full">
                            <SelectValue placeholder="Select…" />
                          </SelectTrigger>
                          <SelectContent>
                            {opts.map((o) => (
                              <SelectItem key={o} value={o}>
                                {o}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })()}
                {inlineEditor.kind === "date-cell" && (
                  <div className="bg-popover border rounded-md shadow-md p-0 min-w-[280px] overflow-hidden">
                    <Calendar
                      mode="single"
                      captionLayout="dropdown"
                      selected={inlineEditorDateValue}
                      defaultMonth={inlineEditorDateValue}
                      onSelect={(d) => {
                        commitInlineEdit(d ?? null);
                      }}
                    />
                  </div>
                )}
                {inlineEditor.kind === "datetime-cell" && (
                  <div className="bg-popover border rounded-md shadow-md p-0 min-w-[280px] overflow-hidden">
                    <Calendar
                      mode="single"
                      captionLayout="dropdown"
                      selected={inlineEditorDateValue}
                      defaultMonth={inlineEditorDateValue}
                      onSelect={(d) => {
                        commitInlineEdit(d ?? null);
                      }}
                    />
                  </div>
                )}
                {inlineEditor.kind === "time-cell" && (
                  <div className="bg-popover border rounded-md shadow-md p-2">
                    <input
                      type="time"
                      className="h-8 text-xs rounded-md border bg-background px-2"
                      defaultValue={
                        typeof inlineEditor.value === "string"
                          ? inlineEditor.value.slice(0, 8)
                          : ""
                      }
                      onChange={(e) => {
                        commitInlineEdit(e.target.value);
                      }}
                    />
                  </div>
                )}
                {inlineEditor.kind === "json-cell" && (
                  <div className="bg-popover border rounded-md shadow-md p-2 min-w-[320px]">
                    <textarea
                      className="font-mono text-xs h-40 w-[420px] rounded-md border bg-background p-2"
                      defaultValue={(() => {
                        try {
                          return JSON.stringify(
                            inlineEditor.value ?? null,
                            null,
                            2,
                          );
                        } catch {
                          return typeof inlineEditor.value === "string"
                            ? inlineEditor.value
                            : "";
                        }
                      })()}
                      onBlur={(e: React.FocusEvent<HTMLTextAreaElement>) => {
                        try {
                          const parsed: unknown = JSON.parse(e.target.value);
                          commitInlineEdit(parsed);
                        } catch {
                          commitInlineEdit(e.target.value);
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </ContextMenuTrigger>

        {/* Load more indicator - show skeleton at bottom when loading more */}
        {isLoadingMore && (
          <div className="absolute bottom-0 left-0 right-0 bg-background/80 backdrop-blur-sm border-t p-2">
            <div className="flex items-center justify-center space-x-2 text-muted-foreground text-xs">
              <div className="animate-spin rounded-full h-4 w-4 border-b border-primary"></div>
              <span>Loading more rows...</span>
            </div>
          </div>
        )}

        <ContextMenuContent className="text-xs">
          <ContextMenuItem
            className="text-xs py-1 px-2 h-7"
            onClick={() => {
              handleCopyWithFormat("text");
            }}
          >
            <Copy className="mr-2 h-3 w-3" />
            Copy
            <ContextMenuShortcut className="text-[10px]">
              ⌘C
            </ContextMenuShortcut>
          </ContextMenuItem>

          <ContextMenuItem
            className="text-xs py-1 px-2 h-7"
            onClick={() => {
              handleCopyWithFormat("csv");
            }}
          >
            <Table className="mr-2 h-3 w-3" />
            Copy as CSV
          </ContextMenuItem>

          <ContextMenuItem
            className="text-xs py-1 px-2 h-7"
            onClick={() => {
              handleCopyWithFormat("json");
            }}
          >
            <FileJson className="mr-2 h-3 w-3" />
            Copy as JSON
          </ContextMenuItem>

          <ContextMenuSeparator className="my-0.5" />

          {getCellValue && contextMenuState.cell && (
            <ContextMenuItem
              className="text-xs py-1 px-2 h-7"
              onClick={() => {
                if (contextMenuState.cell) {
                  handleCellDoubleClick(contextMenuState.cell);
                }
              }}
            >
              <Eye className="mr-2 h-3 w-3" />
              View Cell Value
            </ContextMenuItem>
          )}

          <ContextMenuSeparator className="my-0.5" />

          <ContextMenuItem disabled className="text-xs py-1 px-2 h-7">
            <Search className="mr-2 h-3 w-3" />
            Search in Column
            <ContextMenuShortcut className="text-[10px]">
              ⌘F
            </ContextMenuShortcut>
          </ContextMenuItem>

          <ContextMenuItem disabled className="text-xs py-1 px-2 h-7">
            <Filter className="mr-2 h-3 w-3" />
            Filter Column
          </ContextMenuItem>

          <ContextMenuItem disabled className="text-xs py-1 px-2 h-7">
            <SortAsc className="mr-2 h-3 w-3" />
            Sort Ascending
          </ContextMenuItem>

          <ContextMenuItem disabled className="text-xs py-1 px-2 h-7">
            <SortDesc className="mr-2 h-3 w-3" />
            Sort Descending
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <CellValuePopup
        isOpen={popupState.isOpen}
        onClose={() => {
          setPopupState((prev) => ({ ...prev, isOpen: false }));
        }}
        value={popupState.value}
        columnName={popupState.columnName}
        rowIndex={popupState.rowIndex}
      />
    </>
  );
});
