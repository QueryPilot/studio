import { useCallback, useState, useRef, useEffect } from "react";
import type {
  DrawCellCallback,
  GridMouseEventArgs,
  Item,
  Rectangle,
} from "@glideapps/glide-data-grid";
import type { GridColumnV2, GridRowModel } from "../types";
import type { CellValue } from "@/types/cellValue";
import { toast } from "sonner";

// Copy to clipboard with fallback
async function copyToClipboard(text: string): Promise<void> {
  // Try browser API first (works in all windows)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Fallback for older browsers
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    document.execCommand("copy");
  } finally {
    textArea.remove();
  }
}

export interface CellHoverAction {
  id: string;
  icon: "copy" | "reference";
  tooltip: string;
  onClick: () => void;
}

export interface UseCellHoverIconsOptions {
  columns: GridColumnV2[];
  rows: GridRowModel[];
  onOpenReference?: (
    schema: string,
    table: string,
    column: string,
    value: unknown
  ) => void;
  enabled?: boolean;
  /** Ref to the grid container for attaching click listeners */
  containerRef?: React.RefObject<HTMLElement | null>;
}

export interface UseCellHoverIconsResult {
  hoveredCell: Item | null;
  onItemHovered: (args: GridMouseEventArgs) => void;
  drawCell: DrawCellCallback;
}

// Icon size and padding
const ICON_SIZE = 14;
const BUTTON_SIZE = 22; // Size of individual clickable area
const HOVER_DELAY_MS = 150; // Delay before showing icons
const COPIED_FEEDBACK_MS = 3000; // Duration to show copied checkmark

// Detect dark mode from theme bgCell
function isDarkTheme(bgCell: string): boolean {
  if (bgCell.startsWith('#')) {
    const hex = bgCell.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  }
  return false;
}

// Draw Tabler copy icon (stroke-based)
function drawCopyIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const scale = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Front rectangle with rounded corners (7,7 to 21,21)
  ctx.beginPath();
  ctx.roundRect(7, 7, 14, 14, 2.667);
  ctx.stroke();

  // Back rectangle path
  ctx.beginPath();
  ctx.moveTo(4.012, 16.737);
  ctx.bezierCurveTo(3.4, 16.4, 3, 15.75, 3, 15);
  ctx.lineTo(3, 5);
  ctx.bezierCurveTo(3, 3.9, 3.9, 3, 5, 3);
  ctx.lineTo(15, 3);
  ctx.bezierCurveTo(15.75, 3, 16.158, 3.385, 16.5, 4);
  ctx.stroke();

  ctx.restore();
}

// Draw Tabler clipboard-check icon (copied feedback)
function drawCopiedIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const scale = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Clipboard body
  ctx.beginPath();
  ctx.moveTo(9, 5);
  ctx.lineTo(7, 5);
  ctx.bezierCurveTo(5.9, 5, 5, 5.9, 5, 7);
  ctx.lineTo(5, 19);
  ctx.bezierCurveTo(5, 20.1, 5.9, 21, 7, 21);
  ctx.lineTo(17, 21);
  ctx.bezierCurveTo(18.1, 21, 19, 20.1, 19, 19);
  ctx.lineTo(19, 7);
  ctx.bezierCurveTo(19, 5.9, 18.1, 5, 17, 5);
  ctx.lineTo(15, 5);
  ctx.stroke();

  // Clipboard top (rounded rect)
  ctx.beginPath();
  ctx.roundRect(9, 3, 6, 4, 2);
  ctx.stroke();

  // Checkmark
  ctx.beginPath();
  ctx.moveTo(9, 14);
  ctx.lineTo(11, 16);
  ctx.lineTo(15, 12);
  ctx.stroke();

  ctx.restore();
}

// Draw Tabler external-link icon
function drawLinkIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const scale = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Main rectangle
  ctx.beginPath();
  ctx.moveTo(12, 6);
  ctx.lineTo(6, 6);
  ctx.bezierCurveTo(4.9, 6, 4, 6.9, 4, 8);
  ctx.lineTo(4, 18);
  ctx.bezierCurveTo(4, 19.1, 4.9, 20, 6, 20);
  ctx.lineTo(16, 20);
  ctx.bezierCurveTo(17.1, 20, 18, 19.1, 18, 18);
  ctx.lineTo(18, 12);
  ctx.stroke();

  // Diagonal arrow line
  ctx.beginPath();
  ctx.moveTo(11, 13);
  ctx.lineTo(20, 4);
  ctx.stroke();

  // Arrow head
  ctx.beginPath();
  ctx.moveTo(15, 4);
  ctx.lineTo(20, 4);
  ctx.lineTo(20, 9);
  ctx.stroke();

  ctx.restore();
}

// Determine content alignment based on data type
function getContentAlignment(column: GridColumnV2): "left" | "right" | "center" {
  const dbType = column.meta?.db_type?.toLowerCase() ?? column.type?.toLowerCase() ?? "text";

  // Numbers align right
  if (
    dbType.includes("int") ||
    dbType.includes("numeric") ||
    dbType.includes("decimal") ||
    dbType.includes("float") ||
    dbType.includes("double") ||
    dbType.includes("real") ||
    dbType.includes("money") ||
    dbType.includes("serial")
  ) {
    return "right";
  }

  // Booleans center
  if (dbType.includes("bool")) {
    return "center";
  }

  // Everything else left
  return "left";
}

// Check if a column has a foreign key reference
function getFkReference(column: GridColumnV2): { schema: string; table: string; column: string } | null {
  // Check for FK reference (may be EnhancedColumnMeta)
  const metaWithFk = column.meta as
    | (typeof column.meta & {
        fk_reference?: {
          referenced_schema: string;
          referenced_table: string;
          referenced_column: string;
        };
      })
    | undefined;

  const fkRef = metaWithFk?.fk_reference;
  if (fkRef && fkRef.referenced_table && fkRef.referenced_column) {
    return {
      schema: fkRef.referenced_schema ?? "public",
      table: fkRef.referenced_table,
      column: fkRef.referenced_column,
    };
  }
  return null;
}

export function useCellHoverIcons(
  options: UseCellHoverIconsOptions
): UseCellHoverIconsResult {
  const { columns, rows, onOpenReference, enabled = true, containerRef } = options;
  const [hoveredCell, setHoveredCell] = useState<Item | null>(null);
  const [, setHoveredRow] = useState<number | null>(null);
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);
  const [copiedCell, setCopiedCell] = useState<string | null>(null); // Track which cell was just copied

  // Track icon bounds for click detection
  const iconBoundsRef = useRef<Map<string, { action: string; bounds: Rectangle }[]>>(new Map());

  // Timer for hover delay
  const hoverTimerRef = useRef<number | null>(null);

  // Timer for copied feedback
  const copiedTimerRef = useRef<number | null>(null);

  const onItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      // Clear any pending hover timer
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }

      if (!enabled) {
        setHoveredCell(null);
        return;
      }

      if (args.kind === "cell") {
        const [col, row] = args.location;
        // Update hovered row immediately (no delay for row highlight)
        setHoveredRow(row);
        // Check if this is a different cell than currently hovered
        if (hoveredCell && (hoveredCell[0] !== col || hoveredCell[1] !== row)) {
          // Immediately hide icons when moving to a different cell
          setHoveredCell(null);
          setHoveredButton(null);
        }
        // Add delay before showing icons
        hoverTimerRef.current = window.setTimeout(() => {
          setHoveredCell([col, row]);
          hoverTimerRef.current = null;
        }, HOVER_DELAY_MS);
      } else {
        setHoveredCell(null);
        setHoveredRow(null);
        setHoveredButton(null);
      }
    },
    [enabled, hoveredCell]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
      iconBoundsRef.current.clear();
    };
  }, []);

  const drawCell: DrawCellCallback = useCallback(
    (args, draw) => {
      // Draw the default cell content first
      draw();

      if (!enabled || !hoveredCell) {
        return;
      }

      const { ctx, rect, col, row, theme } = args;

      // Only draw icons on the hovered cell
      if (hoveredCell[0] !== col || hoveredCell[1] !== row) {
        return;
      }

      const column = columns[col];
      const rowData = rows[row];
      if (!column || !rowData) {
        return;
      }

      const cellValue = rowData[column.field] as CellValue | undefined;
      const hasValue = cellValue?.value !== null && cellValue?.value !== undefined;

      // Determine which icons to show
      const icons: { id: string; icon: "copy" | "reference" }[] = [];

      // Always show copy if there's a value
      if (hasValue) {
        icons.push({ id: "copy", icon: "copy" });
      }

      // Show FK reference icon if column has FK
      const fkRef = getFkReference(column);
      // Also check is_fk flag as fallback when fk_reference details aren't loaded
      const isFkColumn = fkRef || column.meta?.is_fk;

      if (isFkColumn && hasValue) {
        icons.push({ id: "reference", icon: "reference" });
      }

      if (icons.length === 0) {
        return;
      }

      // Determine icon position based on content alignment
      const alignment = getContentAlignment(column);
      const iconsOnLeft = alignment === "right"; // Icons opposite to content

      // Calculate grouped container dimensions
      const groupWidth = icons.length * BUTTON_SIZE;
      const groupHeight = BUTTON_SIZE;

      // Icon container position with edge padding
      const edgePadding = 4;
      const groupX = iconsOnLeft
        ? rect.x + edgePadding
        : rect.x + rect.width - groupWidth - edgePadding;

      const groupY = rect.y + (rect.height - groupHeight) / 2;

      // Draw icons
      ctx.save();

      // Store icon bounds for click detection
      const cellKey = `${col},${row}`;
      const cellIconBounds: { action: string; bounds: Rectangle }[] = [];

      // Draw grouped container background
      ctx.fillStyle = theme.bgCell;
      ctx.beginPath();
      ctx.roundRect(groupX, groupY, groupWidth, groupHeight, 4);
      ctx.fill();

      // Draw border around entire group
      ctx.strokeStyle = theme.borderColor ?? theme.bgCellMedium;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw each icon within the group
      icons.forEach((iconDef, index) => {
        // Calculate button position within group
        const buttonX = iconsOnLeft
          ? groupX + index * BUTTON_SIZE
          : groupX + (icons.length - 1 - index) * BUTTON_SIZE;

        // Check if this button is hovered
        const isButtonHovered = hoveredButton === iconDef.id;

        // Draw hover highlight for individual button (stronger contrast)
        if (isButtonHovered) {
          const isDark = isDarkTheme(theme.bgCell);
          ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.1)";
          ctx.beginPath();
          // Apply rounded corners only on the edges
          if (icons.length === 1) {
            ctx.roundRect(buttonX, groupY, BUTTON_SIZE, groupHeight, 4);
          } else if (index === 0 && iconsOnLeft) {
            // First button (left side)
            ctx.roundRect(buttonX, groupY, BUTTON_SIZE, groupHeight, [4, 0, 0, 4]);
          } else if (index === icons.length - 1 && iconsOnLeft) {
            // Last button (right side)
            ctx.roundRect(buttonX, groupY, BUTTON_SIZE, groupHeight, [0, 4, 4, 0]);
          } else if (index === 0 && !iconsOnLeft) {
            // First button on right-aligned (right edge)
            ctx.roundRect(buttonX, groupY, BUTTON_SIZE, groupHeight, [0, 4, 4, 0]);
          } else if (index === icons.length - 1 && !iconsOnLeft) {
            // Last button on right-aligned (left edge)
            ctx.roundRect(buttonX, groupY, BUTTON_SIZE, groupHeight, [4, 0, 0, 4]);
          } else {
            // Middle buttons (no rounded corners)
            ctx.rect(buttonX, groupY, BUTTON_SIZE, groupHeight);
          }
          ctx.fill();
        }

        // Draw divider between buttons (except for last button)
        if (index < icons.length - 1) {
          const dividerX = iconsOnLeft
            ? buttonX + BUTTON_SIZE
            : buttonX;
          ctx.strokeStyle = theme.borderColor ?? theme.bgCellMedium;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(dividerX, groupY + 4);
          ctx.lineTo(dividerX, groupY + groupHeight - 4);
          ctx.stroke();
        }

        // Center icon within button area
        const iconX = buttonX + (BUTTON_SIZE - ICON_SIZE) / 2;
        const iconY = groupY + (groupHeight - ICON_SIZE) / 2;

        // Store bounds for this button
        cellIconBounds.push({
          action: iconDef.id,
          bounds: {
            x: buttonX,
            y: groupY,
            width: BUTTON_SIZE,
            height: groupHeight,
          },
        });

        // Draw icon with appropriate color
        const iconColor = theme.textMedium ?? theme.textDark;
        const successColor = "#22c55e"; // green-500 for copied feedback

        // Check if this cell was just copied
        const isCopied = iconDef.id === "copy" && copiedCell === cellKey;

        if (iconDef.icon === "copy") {
          if (isCopied) {
            drawCopiedIcon(ctx, iconX, iconY, ICON_SIZE, successColor);
          } else {
            drawCopyIcon(ctx, iconX, iconY, ICON_SIZE, iconColor);
          }
        } else {
          drawLinkIcon(ctx, iconX, iconY, ICON_SIZE, iconColor);
        }
      });

      // Store bounds for click detection
      iconBoundsRef.current.set(cellKey, cellIconBounds);

      ctx.restore();
    },
    [enabled, hoveredCell, hoveredButton, copiedCell, columns, rows, onOpenReference]
  );

  // Clear hover state when mouse leaves the container
  useEffect(() => {
    if (!containerRef?.current) {
      return;
    }

    const container = containerRef.current;

    const handleMouseLeave = () => {
      // Clear any pending hover timer
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setHoveredCell(null);
      setHoveredRow(null);
      setHoveredButton(null);
    };

    container.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      container.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [containerRef]);

  // Handle click on icons via container click listener
  useEffect(() => {
    if (!enabled || !containerRef?.current) {
      return;
    }

    const container = containerRef.current;

    const handleClick = (event: MouseEvent) => {
      if (!hoveredCell) {
        return;
      }

      const [col, row] = hoveredCell;
      const cellKey = `${col},${row}`;
      const iconBounds = iconBoundsRef.current.get(cellKey);

      if (!iconBounds || iconBounds.length === 0) {
        return;
      }

      const column = columns[col];
      const rowData = rows[row];
      if (!column || !rowData) {
        return;
      }

      // Get click position relative to container
      const rect = container.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;

      // Check if click is within any icon bounds
      for (const { action, bounds } of iconBounds) {
        if (
          clickX >= bounds.x &&
          clickX <= bounds.x + bounds.width &&
          clickY >= bounds.y &&
          clickY <= bounds.y + bounds.height
        ) {
          // Prevent default cell activation
          event.stopPropagation();
          event.preventDefault();

          // Handle the action
          const cellValue = rowData[column.field] as CellValue | undefined;

          if (action === "copy" && cellValue?.value !== null && cellValue?.value !== undefined) {
            // Copy cell value
            const valueStr = typeof cellValue.value === "object"
              ? JSON.stringify(cellValue.value)
              : String(cellValue.value);

            copyToClipboard(valueStr)
              .then(() => {
                // Show copied feedback icon
                setCopiedCell(cellKey);

                // Clear any existing timer
                if (copiedTimerRef.current !== null) {
                  window.clearTimeout(copiedTimerRef.current);
                }

                // Reset after delay
                copiedTimerRef.current = window.setTimeout(() => {
                  setCopiedCell(null);
                  copiedTimerRef.current = null;
                }, COPIED_FEEDBACK_MS);

                toast.success("Copied to clipboard", {
                  description: valueStr.length > 50 ? `${valueStr.slice(0, 50)}...` : valueStr,
                  duration: 2000,
                });
              })
              .catch((err) => {
                toast.error("Failed to copy", {
                  description: err instanceof Error ? err.message : String(err),
                });
              });

            return;
          }

          if (action === "reference") {
            const fkRef = getFkReference(column);
            if (fkRef && cellValue?.value !== null && cellValue?.value !== undefined) {
              if (onOpenReference) {
                onOpenReference(
                  fkRef.schema,
                  fkRef.table,
                  fkRef.column,
                  cellValue.value
                );
              } else {
                toast.info(`FK Reference: ${fkRef.schema}.${fkRef.table}.${fkRef.column}`, {
                  description: `Value: ${String(cellValue.value)}`,
                });
              }
              return;
            }
          }
        }
      }
    };

    // Also handle mousedown to prevent cell activation
    const handleMouseDown = (event: MouseEvent) => {
      if (!hoveredCell) {
        return;
      }

      const [col, row] = hoveredCell;
      const cellKey = `${col},${row}`;
      const iconBounds = iconBoundsRef.current.get(cellKey);

      if (!iconBounds || iconBounds.length === 0) {
        return;
      }

      // Get click position relative to container
      const rect = container.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;

      // Check if mousedown is within any icon bounds
      for (const { bounds } of iconBounds) {
        if (
          clickX >= bounds.x &&
          clickX <= bounds.x + bounds.width &&
          clickY >= bounds.y &&
          clickY <= bounds.y + bounds.height
        ) {
          // Prevent cell activation by stopping the event
          event.stopPropagation();
          event.preventDefault();
          return;
        }
      }
    };

    // Track button hover state for visual feedback
    const handleMouseMove = (event: MouseEvent) => {
      if (!hoveredCell) {
        if (hoveredButton !== null) {
          setHoveredButton(null);
        }
        return;
      }

      const [col, row] = hoveredCell;
      const cellKey = `${col},${row}`;
      const iconBounds = iconBoundsRef.current.get(cellKey);

      if (!iconBounds || iconBounds.length === 0) {
        if (hoveredButton !== null) {
          setHoveredButton(null);
        }
        return;
      }

      // Get mouse position relative to container
      const rect = container.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      // Check if mouse is over any button
      let foundButton: string | null = null;
      for (const { action, bounds } of iconBounds) {
        if (
          mouseX >= bounds.x &&
          mouseX <= bounds.x + bounds.width &&
          mouseY >= bounds.y &&
          mouseY <= bounds.y + bounds.height
        ) {
          foundButton = action;
          break;
        }
      }

      if (foundButton !== hoveredButton) {
        setHoveredButton(foundButton);
      }

      // Update cursor style
      container.style.cursor = foundButton ? "pointer" : "";
    };

    // Use capture phase to intercept before Glide handles it
    container.addEventListener("click", handleClick, true);
    container.addEventListener("mousedown", handleMouseDown, true);
    container.addEventListener("mousemove", handleMouseMove);

    return () => {
      container.removeEventListener("click", handleClick, true);
      container.removeEventListener("mousedown", handleMouseDown, true);
      container.removeEventListener("mousemove", handleMouseMove);
      container.style.cursor = "";
    };
  }, [enabled, containerRef, hoveredCell, hoveredButton, columns, rows, onOpenReference]);

  return {
    hoveredCell,
    onItemHovered,
    drawCell,
  };
}
