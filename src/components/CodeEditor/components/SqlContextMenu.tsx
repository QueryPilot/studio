/**
 * SQL Context Menu
 *
 * Right-click context menu for SQL identifiers (aliases, tables, columns, CTEs).
 * Provides quick actions like:
 * - Go to Definition
 * - Copy Name/Table Name
 * - Navigate to external structure
 */

import { useEffect } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { IconArrowRight, IconCopy } from "@tabler/icons-react";

export interface SqlContextTarget {
  type: "alias" | "table" | "column" | "cte";
  name: string;
  sourceTable?: string;
  sourceSchema?: string;
  definitionPos?: { from: number; to: number };
  // For columns
  tableName?: string;
}

export interface SqlContextMenuProps {
  target: SqlContextTarget | null;
  position: { x: number; y: number };
  onAction: (action: SqlContextAction, data?: unknown) => void;
  onClose: () => void;
  open: boolean;
}

export type SqlContextAction =
  | "goto-definition"
  | "goto-table-structure"
  | "copy-name"
  | "copy-source-table";

/**
 * SQL Context Menu Component
 */
export function SqlContextMenu({
  target,
  position,
  onAction,
  onClose,
  open,
}: SqlContextMenuProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  if (!target || !open) return null;

  // Build header text
  const getHeaderText = () => {
    switch (target.type) {
      case "alias":
        return `alias ${target.name} → ${target.sourceTable || "?"}`;
      case "cte":
        return `CTE ${target.name}${target.sourceTable ? ` from ${target.sourceTable}` : ""}`;
      case "table":
        return `table ${target.name}`;
      case "column":
        return `column ${target.tableName ? `${target.tableName}.` : ""}${target.name}`;
      default:
        return target.name;
    }
  };

  return (
    <ContextMenu open={open} onOpenChange={(open) => !open && onClose()}>
      <ContextMenuTrigger style={{ display: "none" }} />
      <ContextMenuContent
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
        }}
      >
        <ContextMenuLabel>{getHeaderText()}</ContextMenuLabel>
        <ContextMenuSeparator />

        {/* Go to Definition - for aliases and CTEs */}
        {(target.type === "alias" || target.type === "cte") &&
          target.definitionPos && (
            <ContextMenuItem
              onSelect={() => onAction("goto-definition", target.definitionPos)}
            >
              <IconArrowRight />
              Go to Definition
            </ContextMenuItem>
          )}

        {/* Go to Table Structure - for tables */}
        {target.type === "table" && (
          <ContextMenuItem
            onSelect={() =>
              onAction("goto-table-structure", {
                table: target.name,
                schema: target.sourceSchema,
              })
            }
          >
            <IconArrowRight />
            Go to Table Structure
          </ContextMenuItem>
        )}

        {/* Copy actions */}
        {(target.type === "alias" || target.type === "cte") && (
          <>
            {target.definitionPos && <ContextMenuSeparator />}
            <ContextMenuItem
              onSelect={() => onAction("copy-name", target.name)}
            >
              <IconCopy />
              Copy {target.type === "alias" ? "Alias" : "CTE"} "{target.name}"
            </ContextMenuItem>
            {target.sourceTable && (
              <ContextMenuItem
                onSelect={() =>
                  onAction("copy-source-table", target.sourceTable)
                }
              >
                <IconCopy />
                Copy Table "{target.sourceTable}"
              </ContextMenuItem>
            )}
          </>
        )}

        {target.type === "table" && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => onAction("copy-name", target.name)}
            >
              <IconCopy />
              Copy Table Name
            </ContextMenuItem>
          </>
        )}

        {target.type === "column" && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => onAction("copy-name", target.name)}
            >
              <IconCopy />
              Copy Column Name
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
