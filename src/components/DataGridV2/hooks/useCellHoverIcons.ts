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
const ICON_SPACING = 6;
const BUTTON_SIZE = 22; // Size of the clickable button area
const HOVER_DELAY_MS = 150; // Delay before showing icons

// Simple SVG path data for icons
const COPY_ICON_PATH = "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z";
const LINK_ICON_PATH = "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z";

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
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);

  // Track icon bounds for click detection
  const iconBoundsRef = useRef<Map<string, { action: string; bounds: Rectangle }[]>>(new Map());

  // Timer for hover delay
  const hoverTimerRef = useRef<number | null>(null);

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
        // Add delay before showing icons
        hoverTimerRef.current = window.setTimeout(() => {
          setHoveredCell([col, row]);
          hoverTimerRef.current = null;
        }, HOVER_DELAY_MS);
      } else {
        setHoveredCell(null);
        setHoveredButton(null);
      }
    },
    [enabled]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
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

      // Calculate total width for all buttons
      const totalButtonsWidth = icons.length * BUTTON_SIZE + (icons.length - 1) * ICON_SPACING;

      // Icon container position with edge padding
      const edgePadding = 4;
      const iconContainerX = iconsOnLeft
        ? rect.x + edgePadding
        : rect.x + rect.width - totalButtonsWidth - edgePadding;

      const buttonY = rect.y + (rect.height - BUTTON_SIZE) / 2;

      // Draw icons
      ctx.save();

      // Store icon bounds for click detection
      const cellKey = `${col},${row}`;
      const cellIconBounds: { action: string; bounds: Rectangle }[] = [];

      // Draw each icon in its own separate button
      icons.forEach((iconDef, index) => {
        // Calculate button position
        const buttonX = iconsOnLeft
          ? iconContainerX + index * (BUTTON_SIZE + ICON_SPACING)
          : iconContainerX + (icons.length - 1 - index) * (BUTTON_SIZE + ICON_SPACING);

        // Check if this button is hovered
        const isButtonHovered = hoveredButton === iconDef.id;

        // Draw individual button background with hover effect
        ctx.fillStyle = isButtonHovered
          ? (theme.bgCellMedium ?? theme.bgHeaderHovered ?? "#e5e5e5")
          : theme.bgCell;
        ctx.beginPath();
        ctx.roundRect(buttonX, buttonY, BUTTON_SIZE, BUTTON_SIZE, 4);
        ctx.fill();

        // Add border for each button
        ctx.strokeStyle = theme.borderColor ?? theme.bgCellMedium;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Center icon within button
        const iconX = buttonX + (BUTTON_SIZE - ICON_SIZE) / 2;
        const iconY = buttonY + (BUTTON_SIZE - ICON_SIZE) / 2;

        // Store bounds for this button (use button size for click area)
        cellIconBounds.push({
          action: iconDef.id,
          bounds: {
            x: buttonX,
            y: buttonY,
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
          },
        });

        // Draw icon
        ctx.fillStyle = theme.textMedium ?? theme.textDark;
        ctx.globalAlpha = 0.85;

        // Scale and position the icon path
        ctx.save();
        ctx.translate(iconX, iconY);
        const scale = ICON_SIZE / 24; // SVG viewBox is 24x24
        ctx.scale(scale, scale);

        const path = new Path2D(iconDef.icon === "copy" ? COPY_ICON_PATH : LINK_ICON_PATH);
        ctx.fill(path);

        ctx.restore();
        ctx.globalAlpha = 1;
      });

      // Store bounds for click detection
      iconBoundsRef.current.set(cellKey, cellIconBounds);

      ctx.restore();
    },
    [enabled, hoveredCell, hoveredButton, columns, rows, onOpenReference]
  );

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
