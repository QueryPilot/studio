import { memo, useCallback } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Copy,
  FileJson,
  FileSpreadsheet,
  Database,
  Pin,
  PinOff,
  Trash2,
  Edit,
  Eye,
  Code,
} from "lucide-react";

interface RowContextMenuProps {
  children: React.ReactNode;
  selectedRows: any[];
  onCopyAsCSV: () => void;
  onCopyAsJSON: () => void;
  onCopyAsSQL: () => void;
  onCopyAsInsert: () => void;
  onPinRows?: () => void;
  onUnpinRows?: () => void;
  onDeleteRows?: () => void;
  onEditRow?: () => void;
  onViewDetails?: () => void;
  onOpenChange?: (open: boolean) => void;
  isPinned?: boolean;
  tableName?: string;
  schema?: string;
}

export const RowContextMenu = memo(({
  children,
  selectedRows,
  onCopyAsCSV,
  onCopyAsJSON,
  onCopyAsSQL,
  onCopyAsInsert,
  onPinRows,
  onUnpinRows,
  onDeleteRows,
  onEditRow,
  onViewDetails,
  onOpenChange,
  isPinned = false,
  tableName = "table",
  schema,
}: RowContextMenuProps) => {
  const rowCount = selectedRows.length;
  const rowText = rowCount === 1 ? "row" : "rows";

  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52 text-xs">
        {onViewDetails && (
          <>
            <ContextMenuItem onClick={onViewDetails} className="text-xs h-7">
              <Eye className="mr-1.5 h-3 w-3" />
              View Details
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        
        {/* Copy submenu */}
        <ContextMenuSub>
          <ContextMenuSubTrigger className="text-xs h-7">
            <Copy className="mr-1.5 h-3 w-3" />
            Copy {rowCount} {rowText} as
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44 text-xs">
            <ContextMenuItem onClick={onCopyAsCSV} className="text-xs h-7">
              <FileSpreadsheet className="mr-1.5 h-3 w-3 flex-shrink-0" />
              <span className="whitespace-nowrap">CSV</span>
            </ContextMenuItem>
            <ContextMenuItem onClick={onCopyAsJSON} className="text-xs h-7">
              <FileJson className="mr-1.5 h-3 w-3 flex-shrink-0" />
              <span className="whitespace-nowrap">JSON</span>
            </ContextMenuItem>
            <ContextMenuItem onClick={onCopyAsSQL} className="text-xs h-7">
              <Code className="mr-1.5 h-3 w-3 flex-shrink-0" />
              <span className="whitespace-nowrap">SQL Values</span>
            </ContextMenuItem>
            <ContextMenuItem onClick={onCopyAsInsert} className="text-xs h-7">
              <Database className="mr-1.5 h-3 w-3 flex-shrink-0" />
              <span className="whitespace-nowrap">INSERT Statement</span>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Pin/Unpin */}
        {(onPinRows || onUnpinRows) && (
          <>
            <ContextMenuSeparator />
            {isPinned ? (
              <ContextMenuItem onClick={onUnpinRows} className="text-xs h-7">
                <PinOff className="mr-1.5 h-3 w-3" />
                Unpin {rowCount} {rowText}
              </ContextMenuItem>
            ) : (
              <ContextMenuItem onClick={onPinRows} className="text-xs h-7">
                <Pin className="mr-1.5 h-3 w-3" />
                Pin {rowCount} {rowText}
              </ContextMenuItem>
            )}
          </>
        )}

        {/* Edit (single row only) */}
        {onEditRow && rowCount === 1 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onEditRow} className="text-xs h-7">
              <Edit className="mr-1.5 h-3 w-3" />
              Edit Row
            </ContextMenuItem>
          </>
        )}

        {/* Delete */}
        {onDeleteRows && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onDeleteRows} variant="destructive" className="text-xs h-7">
              <Trash2 className="mr-1.5 h-3 w-3" />
              Delete {rowCount} {rowText}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});

RowContextMenu.displayName = "RowContextMenu";