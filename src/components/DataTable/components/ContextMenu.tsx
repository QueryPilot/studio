/**
 * Context menu component for DataTable row and cell actions
 */
import { memo } from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { 
  Copy, 
  Trash2, 
  Eye, 
  FileText, 
  FileJson,
  Database
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DataTableRow, CopyFormat } from '../types';

interface ContextMenuProps {
  children: React.ReactNode;
  selectedRows: DataTableRow[];
  onCopy: (format: CopyFormat) => void;
  onDelete: () => void;
  onOpenPreview: () => void;
  className?: string;
}

const ContextMenu = memo(function ContextMenu({
  children,
  selectedRows,
  onCopy,
  onDelete,
  onOpenPreview,
  className,
}: ContextMenuProps) {
  const hasSelection = selectedRows.length > 0;
  const selectionText = selectedRows.length === 1 
    ? '1 row' 
    : `${selectedRows.length} rows`;

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        <div className={className}>
          {children}
        </div>
      </ContextMenuPrimitive.Trigger>

      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className={cn(
            "z-50 min-w-[200px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[side=bottom]:slide-in-from-top-2",
            "data-[side=left]:slide-in-from-right-2",
            "data-[side=right]:slide-in-from-left-2",
            "data-[side=top]:slide-in-from-bottom-2"
          )}
        >
          {hasSelection && (
            <>
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {selectionText} selected
              </div>
              <ContextMenuPrimitive.Separator className="my-1 h-px bg-border" />
            </>
          )}

          <ContextMenuPrimitive.Item
            className={cn(
              "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
              "hover:bg-accent hover:text-accent-foreground",
              "data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
            )}
            onClick={onOpenPreview}
            disabled={!hasSelection}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>Open Preview Panel</span>
          </ContextMenuPrimitive.Item>

          <ContextMenuPrimitive.Separator className="my-1 h-px bg-border" />

          <ContextMenuPrimitive.Sub>
            <ContextMenuPrimitive.SubTrigger
              className={cn(
                "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                "hover:bg-accent hover:text-accent-foreground",
                "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              )}
              disabled={!hasSelection}
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Copy as...</span>
              <div className="ml-auto pl-4">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="currentColor"
                >
                  <path d="M3 2L7 5L3 8Z" />
                </svg>
              </div>
            </ContextMenuPrimitive.SubTrigger>

            <ContextMenuPrimitive.Portal>
              <ContextMenuPrimitive.SubContent
                className={cn(
                  "z-50 min-w-[150px] rounded-md border bg-popover p-1 text-popover-foreground shadow-lg",
                  "data-[state=open]:animate-in data-[state=closed]:animate-out",
                  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                  "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                  "data-[side=bottom]:slide-in-from-top-2",
                  "data-[side=left]:slide-in-from-right-2",
                  "data-[side=right]:slide-in-from-left-2",
                  "data-[side=top]:slide-in-from-bottom-2"
                )}
                sideOffset={2}
                alignOffset={-5}
              >
                <ContextMenuPrimitive.Item
                  className={cn(
                    "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                    "hover:bg-accent hover:text-accent-foreground"
                  )}
                  onClick={() => onCopy('json')}
                >
                  <FileJson className="h-3.5 w-3.5" />
                  <span>JSON</span>
                  <span className="ml-auto text-xs text-muted-foreground">⌘J</span>
                </ContextMenuPrimitive.Item>

                <ContextMenuPrimitive.Item
                  className={cn(
                    "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                    "hover:bg-accent hover:text-accent-foreground"
                  )}
                  onClick={() => onCopy('csv')}
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>CSV</span>
                  <span className="ml-auto text-xs text-muted-foreground">⌘C</span>
                </ContextMenuPrimitive.Item>

                <ContextMenuPrimitive.Item
                  className={cn(
                    "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                    "hover:bg-accent hover:text-accent-foreground"
                  )}
                  onClick={() => onCopy('insert')}
                >
                  <Database className="h-3.5 w-3.5" />
                  <span>SQL INSERT</span>
                  <span className="ml-auto text-xs text-muted-foreground">⌘I</span>
                </ContextMenuPrimitive.Item>
              </ContextMenuPrimitive.SubContent>
            </ContextMenuPrimitive.Portal>
          </ContextMenuPrimitive.Sub>

          <ContextMenuPrimitive.Separator className="my-1 h-px bg-border" />

          <ContextMenuPrimitive.Item
            className={cn(
              "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
              "hover:bg-destructive hover:text-destructive-foreground",
              "data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
            )}
            onClick={onDelete}
            disabled={!hasSelection}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete {selectionText}</span>
            <span className="ml-auto text-xs opacity-60">Del</span>
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
});

export { ContextMenu };