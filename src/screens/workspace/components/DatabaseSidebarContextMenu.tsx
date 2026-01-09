import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { IconDownload, IconCopy, IconFileText, IconTrash, IconEye, IconStack2, IconChevronRight, IconStar, IconEraser, IconRefresh, IconBookmark, IconBolt, IconCode } from '@tabler/icons-react';

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

  const hasOnlyTables = selectedTypes.tables > 0 && selectedTypes.views === 0 && selectedTypes.materializedViews === 0 && selectedTypes.functions === 0;
  const hasTablesOrViews = selectedTypes.tables > 0 || selectedTypes.views > 0 || selectedTypes.materializedViews > 0;
  const hasOnlyMaterializedViews = selectedTypes.materializedViews > 0 && selectedTypes.tables === 0 && selectedTypes.views === 0 && selectedTypes.functions === 0;
  const hasTablesOrMaterializedViews = selectedTypes.tables > 0 || selectedTypes.materializedViews > 0;
  const hasOnlyViews = selectedTypes.views > 0 && selectedTypes.tables === 0 && selectedTypes.materializedViews === 0 && selectedTypes.functions === 0;
  const hasOnlyFunctions = selectedTypes.functions > 0 && selectedTypes.tables === 0 && selectedTypes.views === 0 && selectedTypes.materializedViews === 0;
  const hasAnyDatabaseObject = selectedTypes.tables > 0 || selectedTypes.views > 0 || selectedTypes.materializedViews > 0 || selectedTypes.functions > 0;

  // Portal to body to escape overflow:hidden containers
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] bg-popover border border-border rounded-md shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      {/* View options group - all viewing/browsing options together */}
      {hasTablesOrViews && (
        <>
          <MenuItem
            icon={<IconEye className="h-3.5 w-3.5" />}
            label={selectedCount === 1 ? "View Data" : `View Data (${selectedCount})`}
            onClick={() => {
              onViewData();
              onClose();
            }}
          />
          <MenuItem
            icon={<IconStack2 className="h-3.5 w-3.5" />}
            label={selectedCount === 1 ? "View Structure" : `View Structure (${selectedCount})`}
            onClick={() => {
              onViewStructure();
              onClose();
            }}
          />
        </>
      )}

      {/* Indexes - for tables and materialized views */}
      {hasTablesOrMaterializedViews && onViewIndexes && (
        <MenuItem
          icon={<IconBookmark className="h-3.5 w-3.5" />}
          label={selectedCount === 1 ? "View Indexes" : `View Indexes (${selectedCount})`}
          onClick={() => {
            onViewIndexes();
            onClose();
          }}
        />
      )}

      {/* Triggers - only for tables */}
      {hasOnlyTables && onViewTriggers && (
        <MenuItem
          icon={<IconBolt className="h-3.5 w-3.5" />}
          label={selectedCount === 1 ? "View Triggers" : `View Triggers (${selectedCount})`}
          onClick={() => {
            onViewTriggers();
            onClose();
          }}
        />
      )}

      {/* Definition (DDL) - for all database objects */}
      {hasAnyDatabaseObject && onViewDefinition && (
        <MenuItem
          icon={<IconCode className="h-3.5 w-3.5" />}
          label={selectedCount === 1 ? "View Definition" : `View Definition (${selectedCount})`}
          onClick={() => {
            onViewDefinition();
            onClose();
          }}
        />
      )}

      {/* Separator after all view options */}
      {(hasTablesOrViews || hasTablesOrMaterializedViews || hasOnlyTables || hasAnyDatabaseObject) && <MenuSeparator />}

      {/* Export */}
      <MenuItem
        icon={<IconDownload className="h-3.5 w-3.5" />}
        label="Export To File"
        onClick={() => {
          onExport();
          onClose();
        }}
      />

      <MenuSeparator />

      {/* IconCopy options */}
      <MenuItem
        icon={<IconCopy className="h-3.5 w-3.5" />}
        label={selectedCount === 1 ? "Copy Name" : `Copy Names (${selectedCount})`}
        onClick={() => {
          onCopyName();
          onClose();
        }}
      />
      <MenuItem
        icon={<IconFileText className="h-3.5 w-3.5" />}
        label={selectedCount === 1 ? "Copy Definition" : `Copy Definitions (${selectedCount})`}
        onClick={() => {
          onCopyDefinition();
          onClose();
        }}
      />

      {/* Pin/Star */}
      <MenuItem
        icon={<IconStar className="h-3.5 w-3.5" />}
        label={selectedCount === 1 ? "Pin to Top" : `Pin (${selectedCount})`}
        onClick={() => {
          onPin();
          onClose();
        }}
      />

      <MenuSeparator />

      {/* Refresh Materialized Views */}
      {hasOnlyMaterializedViews && onRefreshMaterializedView && (
        <>
          <MenuItem
            icon={<IconRefresh className="h-3.5 w-3.5" />}
            label={selectedCount === 1 ? "Refresh Materialized View" : `Refresh (${selectedCount})`}
            onClick={() => {
              onRefreshMaterializedView();
              onClose();
            }}
          />
          <MenuSeparator />
        </>
      )}

      {/* SQL Operations - only for tables */}
      {hasOnlyTables && selectedCount === 1 && (
        <>
          <MenuItem
            icon={<IconCopy className="h-3.5 w-3.5" />}
            label="Duplicate"
            onClick={() => {
              onDuplicate?.();
              onClose();
            }}
          />
          <MenuSeparator />
        </>
      )}

      {/* Dangerous operations */}
      {hasOnlyTables && (
        <MenuItem
          icon={<IconEraser className="h-3.5 w-3.5" />}
          label={selectedCount === 1 ? "Truncate..." : `Truncate (${selectedCount})...`}
          onClick={() => {
            onTruncate();
            onClose();
          }}
          destructive
        />
      )}

      <MenuItem
        icon={<IconTrash className="h-3.5 w-3.5" />}
        label={selectedCount === 1 ? "Delete..." : `Delete (${selectedCount})...`}
        onClick={() => {
          onDelete();
          onClose();
        }}
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
  hasSubmenu?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}

function MenuItem({
  icon,
  label,
  onClick,
  hasSubmenu,
  destructive,
  disabled,
}: MenuItemProps) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-2 px-2.5 py-1 text-xs hover:bg-accent cursor-pointer transition-colors",
        destructive && "text-red-600 dark:text-red-400",
        disabled && "opacity-50 cursor-not-allowed",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {hasSubmenu && <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}

function MenuSeparator() {
  return <div className="h-px bg-border my-1" />;
}
