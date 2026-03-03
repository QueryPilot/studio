import {
  useEffect,
  useRef,
  useCallback,
  useState,
  useLayoutEffect,
} from "react";
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
  IconChevronRight,
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
    collections: number;
  };
  onClose: () => void;
  canExportData?: boolean;
  canExportDefinition?: boolean;
  onExportDataCSV?: () => void;
  onExportDataJSON?: () => void;
  onExportDataInsert?: () => void;
  onExportDataMarkdown?: () => void;
  onExportDefinition?: () => void;
  onExportDefinitionDBML?: () => void;
  onExportDefinitionMermaid?: () => void;
  onCopyName: () => void;
  onCopyDefinition?: () => void;
  onPin: () => void;
  onTruncate?: () => void;
  onDelete?: () => void;
  onViewData: () => void;
  onViewStructure: () => void;
  onViewIndexes?: () => void;
  onViewTriggers?: () => void;
  onViewDefinition?: () => void;
  onRefreshMaterializedView?: () => void | Promise<void>;
}

interface MenuPosition {
  left: number;
  top: number;
  maxHeight: number;
  overflowY: "auto" | "visible";
}

const MENU_EDGE_PADDING = 8;
const MIN_MENU_MAX_HEIGHT = 160;

export function DatabaseSidebarContextMenu({
  x,
  y,
  selectedCount,
  selectedTypes,
  onClose,
  canExportData = false,
  canExportDefinition = false,
  onExportDataCSV,
  onExportDataJSON,
  onExportDataInsert,
  onExportDataMarkdown,
  onExportDefinition,
  onExportDefinitionDBML,
  onExportDefinitionMermaid,
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
  onRefreshMaterializedView,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<"data" | "definition" | null>(
    null,
  );
  const [menuPosition, setMenuPosition] = useState<MenuPosition>(() => ({
    left: x,
    top: y,
    maxHeight:
      typeof window !== "undefined"
        ? Math.max(MIN_MENU_MAX_HEIGHT, window.innerHeight - MENU_EDGE_PADDING * 2)
        : MIN_MENU_MAX_HEIGHT,
    overflowY: "visible",
  }));

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
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

  const hasOnlyTables =
    selectedTypes.tables > 0 &&
    selectedTypes.views === 0 &&
    selectedTypes.materializedViews === 0 &&
    selectedTypes.functions === 0 &&
    selectedTypes.collections === 0;
  const hasTablesOrViews =
    selectedTypes.tables > 0 ||
    selectedTypes.views > 0 ||
    selectedTypes.materializedViews > 0;
  const hasCollections = selectedTypes.collections > 0;
  const hasOnlyMaterializedViews =
    selectedTypes.materializedViews > 0 &&
    selectedTypes.tables === 0 &&
    selectedTypes.views === 0 &&
    selectedTypes.functions === 0 &&
    selectedTypes.collections === 0;
  const hasTablesOrCollections =
    selectedTypes.tables > 0 || selectedTypes.collections > 0;
  const hasTablesOrMaterializedViews =
    selectedTypes.tables > 0 || selectedTypes.materializedViews > 0;
  const hasAnyDatabaseObject =
    selectedTypes.tables > 0 ||
    selectedTypes.views > 0 ||
    selectedTypes.materializedViews > 0 ||
    selectedTypes.functions > 0;

  const updateMenuPosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxHeight = Math.max(
      MIN_MENU_MAX_HEIGHT,
      viewportHeight - MENU_EDGE_PADDING * 2,
    );

    const spaceBelow = viewportHeight - y - MENU_EDGE_PADDING;
    const spaceAbove = y - MENU_EDGE_PADDING;
    const spaceRight = viewportWidth - x - MENU_EDGE_PADDING;
    const spaceLeft = x - MENU_EDGE_PADDING;

    const needsScroll = rect.height > maxHeight;
    const effectiveHeight = Math.min(rect.height, maxHeight);

    let top = y;
    if (rect.height <= spaceBelow) {
      top = y;
    } else if (rect.height <= spaceAbove) {
      top = y - rect.height;
    } else {
      top = MENU_EDGE_PADDING;
    }

    if (needsScroll) {
      top = MENU_EDGE_PADDING;
    }

    if (top + effectiveHeight > viewportHeight - MENU_EDGE_PADDING) {
      top = viewportHeight - MENU_EDGE_PADDING - effectiveHeight;
    }
    top = Math.max(MENU_EDGE_PADDING, top);

    let left = x;
    if (rect.width > spaceRight) {
      if (rect.width <= spaceLeft) {
        left = x - rect.width;
      } else {
        left = viewportWidth - rect.width - MENU_EDGE_PADDING;
      }
    }

    if (left + rect.width > viewportWidth - MENU_EDGE_PADDING) {
      left = viewportWidth - rect.width - MENU_EDGE_PADDING;
    }
    left = Math.max(MENU_EDGE_PADDING, left);

    setMenuPosition((prev) => {
      if (
        prev.left === left &&
        prev.top === top &&
        prev.maxHeight === maxHeight &&
        prev.overflowY === (needsScroll ? "auto" : "visible")
      ) {
        return prev;
      }

      return {
        left,
        top,
        maxHeight,
        overflowY: needsScroll ? "auto" : "visible",
      };
    });
  }, [x, y]);

  useLayoutEffect(() => {
    updateMenuPosition();
  }, [
    updateMenuPosition,
    openSubmenu,
    selectedCount,
    selectedTypes,
    canExportData,
    canExportDefinition,
  ]);

  useEffect(() => {
    const handleResize = () => {
      updateMenuPosition();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [updateMenuPosition]);

  // Wrap handlers to close menu after action
  const withClose = useCallback(
    (handler: () => void | Promise<void>) => () => {
      void handler();
      onClose();
    },
    [onClose]
  );

  // Portal to body to escape overflow:hidden containers
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[200px] bg-popover text-popover-foreground rounded-lg p-1 shadow-lg border border-border"
      style={{
        left: menuPosition.left,
        top: menuPosition.top,
        maxHeight: menuPosition.maxHeight,
        overflowY: menuPosition.overflowY,
      }}
    >
      {/* View options group - all viewing/browsing options together */}
      {(hasTablesOrViews || hasCollections) && (
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
        hasCollections ||
        hasTablesOrMaterializedViews ||
        hasOnlyTables ||
        hasAnyDatabaseObject) && <ContextMenuSeparator className="mx-0" />}

      {/* Export */}
      <MenuSub
        icon={<IconDownload />}
        label="Export Data"
        disabled={!canExportData}
        isOpen={openSubmenu === "data"}
        onOpen={() => {
          setOpenSubmenu("data");
        }}
        onClose={() => {
          setOpenSubmenu((prev) => (prev === "data" ? null : prev));
        }}
      >
        <MenuItem
          icon={<IconDownload />}
          label="CSV"
          onClick={withClose(onExportDataCSV ?? (() => {}))}
        />
        <MenuItem
          icon={<IconDownload />}
          label="JSON"
          onClick={withClose(onExportDataJSON ?? (() => {}))}
        />
        <MenuItem
          icon={<IconDownload />}
          label="SQL INSERT"
          onClick={withClose(onExportDataInsert ?? (() => {}))}
        />
        <MenuItem
          icon={<IconDownload />}
          label="Markdown"
          onClick={withClose(onExportDataMarkdown ?? (() => {}))}
        />
      </MenuSub>
      <MenuSub
        icon={<IconFileText />}
        label="Export Definition"
        disabled={!canExportDefinition}
        isOpen={openSubmenu === "definition"}
        onOpen={() => {
          setOpenSubmenu("definition");
        }}
        onClose={() => {
          setOpenSubmenu((prev) => (prev === "definition" ? null : prev));
        }}
      >
        <MenuItem
          icon={<IconFileText />}
          label="SQL"
          onClick={withClose(onExportDefinition ?? (() => {}))}
        />
        <MenuItem
          icon={<IconFileText />}
          label="DBML"
          onClick={withClose(onExportDefinitionDBML ?? (() => {}))}
          disabled={!onExportDefinitionDBML}
        />
        <MenuItem
          icon={<IconFileText />}
          label="Mermaid ERD"
          onClick={withClose(onExportDefinitionMermaid ?? (() => {}))}
          disabled={!onExportDefinitionMermaid}
        />
      </MenuSub>

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
        label={(() => {
          const baseLabel =
            selectedCount === 1
              ? "Copy Definition"
              : `Copy Definitions (${selectedCount})`;
          return onCopyDefinition ? baseLabel : `${baseLabel} (coming soon)`;
        })()}
        onClick={onCopyDefinition ? withClose(onCopyDefinition) : undefined}
        disabled={!onCopyDefinition}
      />

      {/* Pin/Star */}
      <MenuItem
        icon={<IconStar />}
        label={selectedCount === 1 ? "Pin to Top" : `Pin (${selectedCount})`}
        onClick={withClose(onPin)}
      />

      <ContextMenuSeparator className="mx-0" />

      {/* Refresh Materialized Views */}
      {hasOnlyMaterializedViews && (
        <>
          <MenuItem
            icon={<IconRefresh />}
            label={(() => {
              const baseLabel =
                selectedCount === 1
                  ? "Refresh Materialized View"
                  : `Refresh (${selectedCount})`;
              return onRefreshMaterializedView
                ? baseLabel
                : `${baseLabel} (coming soon)`;
            })()}
            onClick={
              onRefreshMaterializedView
                ? withClose(onRefreshMaterializedView)
                : undefined
            }
            disabled={!onRefreshMaterializedView}
          />
          <ContextMenuSeparator className="mx-0" />
        </>
      )}

      {/* Dangerous operations */}
      {hasTablesOrCollections && (
        <MenuItem
          icon={<IconEraser />}
          label={(() => {
            const baseLabel =
              selectedCount === 1
                ? "Truncate..."
                : `Truncate (${selectedCount})...`;
            return onTruncate ? baseLabel : `${baseLabel} (coming soon)`;
          })()}
          onClick={onTruncate ? withClose(onTruncate) : undefined}
          disabled={!onTruncate}
          destructive
        />
      )}

      <MenuItem
        icon={<IconTrash />}
        label={(() => {
          const baseLabel =
            selectedCount === 1 ? "Delete..." : `Delete (${selectedCount})...`;
          return onDelete ? baseLabel : `${baseLabel} (coming soon)`;
        })()}
        onClick={onDelete ? withClose(onDelete) : undefined}
        disabled={!onDelete}
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

interface MenuSubProps {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: React.ReactNode;
}

function MenuSub({
  icon,
  label,
  disabled,
  isOpen,
  onOpen,
  onClose,
  children,
}: MenuSubProps) {
  return (
    <div
      className="relative"
      onMouseEnter={() => {
        if (!disabled) onOpen();
      }}
      onMouseLeave={() => {
        if (!disabled) onClose();
      }}
    >
      <button
        className={cn(
          "w-full flex items-center gap-2 min-h-7 rounded-md px-2 py-1 text-xs cursor-default transition-colors",
          "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
          "outline-none select-none",
          "[&_svg]:size-3.5 [&_svg]:shrink-0",
          disabled && "pointer-events-none opacity-50",
        )}
        disabled={disabled}
      >
        {icon}
        <span className="flex-1 text-left">{label}</span>
        <IconChevronRight />
      </button>
      {isOpen && !disabled && (
        <div className="absolute left-full top-0 ml-1 z-[10000] min-w-[180px] rounded-lg border border-border bg-popover p-1 shadow-lg">
          {children}
        </div>
      )}
    </div>
  );
}
