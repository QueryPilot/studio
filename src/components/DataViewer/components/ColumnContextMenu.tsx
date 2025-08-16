import { memo } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { EyeOff } from "lucide-react";

interface ColumnContextMenuProps {
  children: React.ReactNode;
  columnId: string;
  onHideColumn: (columnId: string) => void;
}

export const ColumnContextMenu = memo(({
  children,
  columnId,
  onHideColumn,
}: ColumnContextMenuProps) => {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 text-xs">
        <ContextMenuItem 
          onClick={() => onHideColumn(columnId)}
          className="text-xs h-7"
        >
          <EyeOff className="mr-1.5 h-3 w-3" />
          Hide Column
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

ColumnContextMenu.displayName = "ColumnContextMenu";