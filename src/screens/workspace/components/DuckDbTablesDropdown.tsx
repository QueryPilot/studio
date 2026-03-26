import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  IconTablePlus,
  IconFileImport,
  IconLink,
  IconDatabaseImport,
} from "@tabler/icons-react";

export interface DuckDbConnectedSource {
  id: string;
  name: string;
}

interface DuckDbTablesDropdownProps {
  onNewTable: () => void;
  onImportFile: () => void;
  onImportUrl: () => void;
  connections: DuckDbConnectedSource[];
  onSnapshotFromConnection: (connectionId: string, connectionName: string) => void;
  disabled?: boolean;
}

export function DuckDbTablesDropdown({
  onNewTable,
  onImportFile,
  onImportUrl,
  connections,
  onSnapshotFromConnection,
  disabled = false,
}: DuckDbTablesDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="p-1 mr-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        disabled={disabled}
        render={<button type="button" />}
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="min-w-[220px]">
        <DropdownMenuItem onClick={onNewTable}>
          <IconTablePlus className="h-4 w-4 mr-2" />
          New Table...
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportFile}>
          <IconFileImport className="h-4 w-4 mr-2" />
          Import from File...
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportUrl}>
          <IconLink className="h-4 w-4 mr-2" />
          Import from URL...
        </DropdownMenuItem>
        {connections.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <IconDatabaseImport className="h-4 w-4 mr-2" />
                Snapshot from Connection
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {connections.map((conn) => (
                  <DropdownMenuItem
                    key={conn.id}
                    onClick={() => {
                      onSnapshotFromConnection(conn.id, conn.name);
                    }}
                  >
                    {conn.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
