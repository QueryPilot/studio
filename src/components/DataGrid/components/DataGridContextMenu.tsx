import { memo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Copy,
  Eye,
  Trash2,
  FileJson,
  FileText,
  Table,
  Database,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
  submenu?: ContextMenuItem[];
  onClick?: () => void;
}

interface DataGridContextMenuProps {
  position: ContextMenuPosition | null;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const DataGridContextMenu = memo(function DataGridContextMenu({
  position,
  items,
  onClose,
}: DataGridContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [position, onClose]);

  if (!position) return null;

  // Adjust position to ensure menu stays within viewport
  const adjustedPosition = { ...position };
  const menuWidth = 200;
  const menuHeight = items.length * 32 + 8;

  if (position.x + menuWidth > window.innerWidth) {
    adjustedPosition.x = window.innerWidth - menuWidth - 8;
  }
  if (position.y + menuHeight > window.innerHeight) {
    adjustedPosition.y = window.innerHeight - menuHeight - 8;
  }

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-popover border rounded-md shadow-md py-0.5"
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
      }}
    >
      {items.map((item) => {
        if (item.separator) {
          return <div key={item.id} className="h-px bg-border my-0.5" />;
        }

        if (item.submenu) {
          return (
            <SubmenuItem
              key={item.id}
              item={item}
              onClose={onClose}
            />
          );
        }

        return (
          <MenuItem
            key={item.id}
            item={item}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
          />
        );
      })}
    </div>,
    document.body
  );
});

const MenuItem = memo(function MenuItem({
  item,
  onClick,
}: {
  item: ContextMenuItem;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-1.5 w-full px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground",
        "focus:bg-accent focus:text-accent-foreground focus:outline-none",
        item.disabled && "opacity-50 cursor-not-allowed"
      )}
      disabled={item.disabled}
      onClick={onClick}
    >
      {item.icon && <span className="w-3 h-3">{item.icon}</span>}
      <span className="flex-1 text-left whitespace-nowrap">{item.label}</span>
      {item.shortcut && (
        <span className="text-[10px] text-muted-foreground ml-auto">
          {item.shortcut}
        </span>
      )}
    </button>
  );
});

const SubmenuItem = memo(function SubmenuItem({
  item,
  onClose,
}: {
  item: ContextMenuItem;
  onClose: () => void;
}) {
  const submenuRef = useRef<HTMLDivElement>(null);
  const [showSubmenu, setShowSubmenu] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowSubmenu(true)}
      onMouseLeave={() => setShowSubmenu(false)}
    >
      <button
        className={cn(
          "flex items-center gap-1.5 w-full px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground",
          "focus:bg-accent focus:text-accent-foreground focus:outline-none"
        )}
      >
        {item.icon && <span className="w-3 h-3">{item.icon}</span>}
        <span className="flex-1 text-left whitespace-nowrap">{item.label}</span>
        <ChevronRight className="w-3 h-3 ml-auto" />
      </button>
      
      {showSubmenu && item.submenu && (
        <div
          ref={submenuRef}
          className="absolute left-full top-0 ml-0.5 min-w-[160px] bg-popover border rounded-md shadow-md py-0.5 whitespace-nowrap"
        >
          {item.submenu.map((subItem) => (
            <MenuItem
              key={subItem.id}
              item={subItem}
              onClick={() => {
                subItem.onClick?.();
                onClose();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
});

import { useState } from 'react';

// Export predefined menu items factory
export function createDataGridMenuItems({
  onShowPreview,
  onCopyCellValue,
  onCopyRows,
  onCopyAsJson,
  onCopyAsCsv,
  onCopyAsMarkdown,
  onCopyAsSql,
  onDelete,
  hasSelection,
  hasCellFocus,
}: {
  onShowPreview: () => void;
  onCopyCellValue: () => void;
  onCopyRows: () => void;
  onCopyAsJson: () => void;
  onCopyAsCsv: () => void;
  onCopyAsMarkdown: () => void;
  onCopyAsSql: () => void;
  onDelete: () => void;
  hasSelection: boolean;
  hasCellFocus: boolean;
}): ContextMenuItem[] {
  return [
    {
      id: 'show-preview',
      label: 'Show Preview',
      icon: <Eye className="w-3 h-3" />,
      onClick: onShowPreview,
      disabled: !hasSelection,
    },
    {
      id: 'separator-1',
      separator: true,
      label: '',
    },
    {
      id: 'copy-cell',
      label: 'Copy Cell Value',
      icon: <Copy className="w-3 h-3" />,
      shortcut: '⌘C',
      onClick: onCopyCellValue,
      disabled: !hasCellFocus,
    },
    {
      id: 'copy-rows',
      label: 'Copy Rows',
      icon: <Copy className="w-3 h-3" />,
      onClick: onCopyRows,
      disabled: !hasSelection,
    },
    {
      id: 'copy-as',
      label: 'Copy As',
      icon: <FileText className="w-3 h-3" />,
      disabled: !hasSelection,
      submenu: [
        {
          id: 'copy-as-json',
          label: 'JSON',
          icon: <FileJson className="w-3 h-3" />,
          onClick: onCopyAsJson,
        },
        {
          id: 'copy-as-csv',
          label: 'CSV',
          icon: <FileText className="w-3 h-3" />,
          onClick: onCopyAsCsv,
        },
        {
          id: 'copy-as-markdown',
          label: 'Markdown Table',
          icon: <Table className="w-3 h-3" />,
          onClick: onCopyAsMarkdown,
        },
        {
          id: 'copy-as-sql',
          label: 'INSERT Statement',
          icon: <Database className="w-3 h-3" />,
          onClick: onCopyAsSql,
        },
      ],
    },
    {
      id: 'separator-2',
      separator: true,
      label: '',
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 className="w-3 h-3" />,
      onClick: onDelete,
      disabled: !hasSelection,
    },
  ];
}