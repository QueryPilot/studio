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
  IconFileExport,
  IconLink,
  IconDatabaseImport,
  IconPlugConnected,
  IconPlugConnectedX,
  IconKey,
  IconPuzzle,
} from "@tabler/icons-react";

export interface DuckDbConnectedSource {
  id: string;
  name: string;
}

export interface DuckDbAttachedDatabaseEntry {
  databaseName: string;
  path: string;
  dbType: string;
  readOnly: boolean;
}

interface DuckDbTablesDropdownProps {
  onNewTable: () => void;
  onImportFile: () => void;
  onImportUrl: () => void;
  onExportData?: () => void;
  onAttachDatabase?: () => void;
  onDetachDatabase?: (alias: string) => void;
  onManageSecrets?: () => void;
  onManageExtensions?: () => void;
  attachedDatabases?: DuckDbAttachedDatabaseEntry[];
  connections: DuckDbConnectedSource[];
  onSnapshotFromConnection: (connectionId: string, connectionName: string) => void;
  disabled?: boolean;
}

export function DuckDbTablesDropdown({
  onNewTable,
  onImportFile,
  onImportUrl,
  onExportData,
  onAttachDatabase,
  onDetachDatabase,
  onManageSecrets,
  onManageExtensions,
  attachedDatabases = [],
  connections,
  onSnapshotFromConnection,
  disabled = false,
}: DuckDbTablesDropdownProps) {
  const detachableDatabases = attachedDatabases.filter(
    (db) => db.databaseName !== "memory" && db.databaseName !== "system",
  );
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
        {onExportData && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onExportData}>
              <IconFileExport className="h-4 w-4 mr-2" />
              Export...
            </DropdownMenuItem>
          </>
        )}
        {onAttachDatabase && (
          <DropdownMenuItem onClick={onAttachDatabase}>
            <IconPlugConnected className="h-4 w-4 mr-2" />
            Attach Database...
          </DropdownMenuItem>
        )}
        {onManageSecrets && (
          <DropdownMenuItem onClick={onManageSecrets}>
            <IconKey className="h-4 w-4 mr-2" />
            Secrets...
          </DropdownMenuItem>
        )}
        {onManageExtensions && (
          <DropdownMenuItem onClick={onManageExtensions}>
            <IconPuzzle className="h-4 w-4 mr-2" />
            Extensions...
          </DropdownMenuItem>
        )}
        {onDetachDatabase && detachableDatabases.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <IconPlugConnectedX className="h-4 w-4 mr-2" />
              Detach Database
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {detachableDatabases.map((db) => (
                <DropdownMenuItem
                  key={db.databaseName}
                  onClick={() => {
                    onDetachDatabase(db.databaseName);
                  }}
                >
                  <span className="truncate">{db.databaseName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {db.dbType || "duckdb"}
                    {db.readOnly ? " (ro)" : ""}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
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
