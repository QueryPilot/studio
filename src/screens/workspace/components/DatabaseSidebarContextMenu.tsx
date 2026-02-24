import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  IconDownload,
  IconCopy,
  IconFileText,
  IconTrash,
  IconEye,
  IconStack2,
  IconStar,
  IconEraser,
  IconRefresh,
  IconBookmark,
  IconBolt,
  IconCode,
} from "@tabler/icons-react";
import {
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

interface ContextMenuProps {
  x: number;
  y: number;
  selectedCount: number;
  selectedTypes: {
    tables: number;
    views: number;
    materializedViews: number;
    functions: number;
  };
  onClose: () => void;
  onExport: () => void;
  onCopyName: () => void;
  onCopyDefinition: () => void;
  onPin: () => void;
  onTruncate: () => void;
  onDelete: () => void;
  onViewData: () => void;
  onViewStructure: () => void;
  onViewIndexes?: () => void;
  onViewTriggers?: () => void;
  onViewDefinition?: () => void;
  onDuplicate?: () => void;
  onRefreshMaterializedView?: () => void | Promise<void>;
}

export function DatabaseSidebarContextMenu({
  x,
  y,
  selectedCount,
  selectedTypes,
  onClose,
  onExport,
  onCopyName,
  onCopyDefinition,
  onPin,
  onTruncate,
  onDelete,
  onViewData,
  onViewStructure,
  onViewIndexes,
  onViewTriggers,
  onViewDefinition,
  onDuplicate,
  onRefreshMaterializedView,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Adjust position if menu goes off screen
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      if (rect.right > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 10;
      }

      if (rect.bottom > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 10;
      }

      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [x, y]);

  const hasOnlyTables =
    selectedTypes.tables > 0 &&
    selectedTypes.views === 0 &&
    selectedTypes.materializedViews === 0 &&
    selectedTypes.functions === 0;
  const hasTablesOrViews =
    selectedTypes.tables > 0 ||
    selectedTypes.views > 0 ||
    selectedTypes.materializedViews > 0;
  const hasOnlyMaterializedViews =
    selectedTypes.materializedViews > 0 &&
    selectedTypes.tables === 0 &&
    selectedTypes.views === 0 &&
    selectedTypes.functions === 0;
  const hasTablesOrMaterializedViews =
    selectedTypes.tables > 0 || selectedTypes.materializedViews > 0;
  const hasAnyDatabaseObject =
    selectedTypes.tables > 0 ||
    selectedTypes.views > 0 ||
    selectedTypes.materializedViews > 0 ||
    selectedTypes.functions > 0;

  // Wrap handlers to close menu after action
  const withClose = useCallback(
    (handler: () => void) => () => {
      handler();
      onClose();
    },
    [onClose]
  );

  // Portal to body to escape overflow:hidden containers
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[200px] bg-popover text-popover-foreground rounded-lg p-1 shadow-lg border border-border"
      style={{ left: x, top: y }}
    >
      {/* View options group - all viewing/browsing options together */}
      {hasTablesOrViews && (
        <>
          <MenuItem
            icon={<IconEye />}
            label={
              selectedCount === 1 ? "View Data" : `View Data (${selectedCount})`
            }
            onClick={withClose(onViewData)}
          />
          <MenuItem
            icon={<IconStack2 />}
            label={
              selectedCount === 1
                ? "View Structure"
                : `View Structure (${selectedCount})`
            }
            onClick={withClose(onViewStructure)}
          />
        </>
      )}

      {/* Indexes - for tables and materialized views */}
      {hasTablesOrMaterializedViews && onViewIndexes && (
        <MenuItem
          icon={<IconBookmark />}
          label={
            selectedCount === 1
              ? "View Indexes"
              : `View Indexes (${selectedCount})`
          }
          onClick={withClose(onViewIndexes)}
        />
      )}

      {/* Triggers - only for tables */}
      {hasOnlyTables && onViewTriggers && (
        <MenuItem
          icon={<IconBolt />}
          label={
            selectedCount === 1
              ? "View Triggers"
              : `View Triggers (${selectedCount})`
          }
          onClick={withClose(onViewTriggers)}
        />
      )}

      {/* Definition (DDL) - for all database objects */}
      {hasAnyDatabaseObject && onViewDefinition && (
        <MenuItem
          icon={<IconCode />}
          label={
            selectedCount === 1
              ? "View Definition"
              : `View Definition (${selectedCount})`
          }
          onClick={withClose(onViewDefinition)}
        />
      )}

      {/* Separator after all view options */}
      {(hasTablesOrViews ||
        hasTablesOrMaterializedViews ||
        hasOnlyTables ||
        hasAnyDatabaseObject) && <ContextMenuSeparator className="mx-0" />}

      {/* Export */}
      <MenuItem
        icon={<IconDownload />}
        label="Export To File"
        onClick={withClose(onExport)}
      />

      <ContextMenuSeparator className="mx-0" />

      {/* Copy options */}
      <MenuItem
        icon={<IconCopy />}
        label={
          selectedCount === 1 ? "Copy Name" : `Copy Names (${selectedCount})`
        }
        onClick={withClose(onCopyName)}
      />
      <MenuItem
        icon={<IconFileText />}
        label={
          selectedCount === 1
            ? "Copy Definition"
            : `Copy Definitions (${selectedCount})`
        }
        onClick={withClose(onCopyDefinition)}
      />

      {/* Pin/Star */}
      <MenuItem
        icon={<IconStar />}
        label={selectedCount === 1 ? "Pin to Top" : `Pin (${selectedCount})`}
        onClick={withClose(onPin)}
      />

      <ContextMenuSeparator className="mx-0" />

      {/* Refresh Materialized Views */}
      {hasOnlyMaterializedViews && onRefreshMaterializedView && (
        <>
          <MenuItem
            icon={<IconRefresh />}
            label={
              selectedCount === 1
                ? "Refresh Materialized View"
                : `Refresh (${selectedCount})`
            }
            onClick={withClose(onRefreshMaterializedView)}
          />
          <ContextMenuSeparator className="mx-0" />
        </>
      )}

      {/* SQL Operations - only for tables */}
      {hasOnlyTables && selectedCount === 1 && (
        <>
          <MenuItem
            icon={<IconCopy />}
            label="Duplicate"
            onClick={withClose(onDuplicate ?? (() => {}))}
          />
          <ContextMenuSeparator className="mx-0" />
        </>
      )}

      {/* Dangerous operations */}
      {hasOnlyTables && (
        <MenuItem
          icon={<IconEraser />}
          label={
            selectedCount === 1
              ? "Truncate..."
              : `Truncate (${selectedCount})...`
          }
          onClick={withClose(onTruncate)}
          destructive
        />
      )}

      <MenuItem
        icon={<IconTrash />}
        label={
          selectedCount === 1 ? "Delete..." : `Delete (${selectedCount})...`
        }
        onClick={withClose(onDelete)}
        destructive
      />
    </div>,
    document.body
  );
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
  disabled,
}: MenuItemProps) {
  return (
    <button
      className={cn(
        // Match standard ContextMenuItem styling
        "w-full flex items-center gap-2 min-h-7 rounded-md px-2 py-1 text-xs cursor-default transition-colors",
        "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
        "outline-none select-none",
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
        destructive && "text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive",
        disabled && "pointer-events-none opacity-50"
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}
