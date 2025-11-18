import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Download,
  Upload,
  Copy,
  FileText,
  Trash2,
  Eye,
  EyeOff,
  Layers,
  ChevronRight,
} from "lucide-react";

interface ContextMenuProps {
  x: number;
  y: number;
  selectedCount: number;
  selectedTypes: {
    tables: number;
    views: number;
    functions: number;
  };
  onClose: () => void;
  onExport: () => void;
  onImport: () => void;
  onCopyName: () => void;
  onDelete: () => void;
  onViewData: () => void;
  onViewStructure: () => void;
  onHide: () => void;
  onDuplicate?: () => void;
}

export function DatabaseSidebarContextMenu({
  x,
  y,
  selectedCount,
  selectedTypes,
  onClose,
  onExport,
  onImport,
  onCopyName,
  onDelete,
  onViewData,
  onViewStructure,
  onHide,
  onDuplicate,
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

  const hasOnlyTables = selectedTypes.tables > 0 && selectedTypes.views === 0 && selectedTypes.functions === 0;
  const hasTablesOrViews = selectedTypes.tables > 0 || selectedTypes.views > 0;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] bg-popover border border-border rounded-md shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      {/* Data viewing options - only for tables/views */}
      {hasTablesOrViews && (
        <>
          <MenuItem
            icon={<Eye className="h-4 w-4" />}
            label={selectedCount === 1 ? "View Data" : `View Data (${selectedCount})`}
            onClick={() => {
              onViewData();
              onClose();
            }}
          />
          <MenuItem
            icon={<Layers className="h-4 w-4" />}
            label={selectedCount === 1 ? "View Structure" : `View Structure (${selectedCount})`}
            onClick={() => {
              onViewStructure();
              onClose();
            }}
          />
          <MenuSeparator />
        </>
      )}

      {/* Export/Import */}
      <MenuItem
        icon={<Download className="h-4 w-4" />}
        label="Export To File"
        hasSubmenu
        onClick={() => {
          onExport();
          onClose();
        }}
      />
      <MenuItem
        icon={<Upload className="h-4 w-4" />}
        label="Import from File"
        onClick={() => {
          onImport();
          onClose();
        }}
      />

      <MenuSeparator />

      {/* Copy name */}
      <MenuItem
        icon={<Copy className="h-4 w-4" />}
        label={selectedCount === 1 ? "Copy Name" : `Copy Names (${selectedCount})`}
        onClick={() => {
          onCopyName();
          onClose();
        }}
      />

      {/* Hide */}
      <MenuItem
        icon={<EyeOff className="h-4 w-4" />}
        label={selectedCount === 1 ? "Hide" : `Hide (${selectedCount})`}
        onClick={() => {
          onHide();
          onClose();
        }}
      />

      <MenuSeparator />

      {/* SQL Operations - only for tables */}
      {hasOnlyTables && selectedCount === 1 && (
        <>
          <MenuItem
            icon={<FileText className="h-4 w-4" />}
            label="SQL: Create"
            hasSubmenu
          />
          <MenuItem
            icon={<Copy className="h-4 w-4" />}
            label="Duplicate"
            onClick={() => {
              onDuplicate?.();
              onClose();
            }}
          />
          <MenuSeparator />
        </>
      )}

      {/* Delete */}
      <MenuItem
        icon={<Trash2 className="h-4 w-4" />}
        label={selectedCount === 1 ? "Delete..." : `Delete (${selectedCount})...`}
        onClick={() => {
          onDelete();
          onClose();
        }}
        destructive
      />
    </div>
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
        "w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors",
        destructive && "text-red-600 dark:text-red-400",
        disabled && "opacity-50 cursor-not-allowed",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {hasSubmenu && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
    </button>
  );
}

function MenuSeparator() {
  return <div className="h-px bg-border my-1" />;
}
