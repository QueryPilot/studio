import { memo, useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Link, X, ChevronRight } from "lucide-react";
import { databaseService } from "@/services/databaseService";

interface ForeignKeyRef {
  table: string;
  column: string;
}

interface ForeignKeySelectorProps {
  value?: ForeignKeyRef | null;
  onChange: (value: ForeignKeyRef | null) => void;
  connectionId?: string;
  database?: string;
  schema?: string;
  disabled?: boolean;
  className?: string;
  currentTable?: string;
  currentColumn?: string;
}

interface TableColumn {
  table: string;
  column: string;
  type: string;
}

export const ForeignKeySelector = memo(function ForeignKeySelector({
  value,
  onChange,
  connectionId,
  database = "public",
  schema = "public",
  disabled = false,
  className,
  currentTable,
  currentColumn,
}: ForeignKeySelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [availableTargets, setAvailableTargets] = useState<TableColumn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  // Load available foreign key targets
  useEffect(() => {
    if (connectionId && open && !isLoading) {
      setIsLoading(true);

      // Get all tables and their primary key columns
      databaseService
        .getForeignKeyTargets(connectionId, database, schema)
        .then((targets) => {
          // If no targets returned, use mock data for now
          if (!targets || targets.length === 0) {
            // Mock data for testing - remove this when backend is ready
            targets = [
              { table: 'users', column: 'id', type: 'int4' },
              { table: 'todos', column: 'id', type: 'int4' },
              { table: 'categories', column: 'id', type: 'int4' },
              { table: 'projects', column: 'id', type: 'uuid' },
              { table: 'tags', column: 'id', type: 'int8' },
            ];
          }

          setAvailableTargets(targets);

          // If there's an existing value, pre-select its table
          if (value?.table) {
            setSelectedTable(value.table);
          }
        })
        .catch((err) => {
          console.error("Failed to load foreign key targets:", err);
          // Use mock data on error for now
          const mockTargets = [
            { table: 'users', column: 'id', type: 'int4' },
            { table: 'todos', column: 'id', type: 'int4' },
            { table: 'categories', column: 'id', type: 'int4' },
            { table: 'projects', column: 'id', type: 'uuid' },
            { table: 'tags', column: 'id', type: 'int8' },
          ];
          setAvailableTargets(mockTargets);

          if (value?.table) {
            setSelectedTable(value.table);
          }
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [connectionId, open]);

  // Filter and group targets
  const { tables, columnsForTable } = useMemo(() => {
    const filtered = availableTargets.filter(target => {
      const searchLower = search.toLowerCase();
      return target.table.toLowerCase().includes(searchLower) ||
             target.column.toLowerCase().includes(searchLower);
    });

    // Get unique tables
    const uniqueTables = Array.from(new Set(filtered.map(t => t.table)))
      .filter(table => table !== currentTable) // Exclude current table
      .sort();

    // Get columns for selected table
    const columns = selectedTable
      ? filtered.filter(t => t.table === selectedTable)
      : [];

    return {
      tables: uniqueTables,
      columnsForTable: columns,
    };
  }, [availableTargets, search, selectedTable, currentTable]);

  const handleSelect = (table: string, column: string) => {
    onChange({ table, column });
    setOpen(false);
    setSelectedTable(null);
    setSearch("");
  };

  const handleClear = () => {
    onChange(null);
    setSelectedTable(null);
  };

  // Reset selected table when popup closes
  useEffect(() => {
    if (!open) {
      setSearch("");
      // Only reset selectedTable if there's no current value
      // This prevents flickering when reopening
      if (!value?.table) {
        setSelectedTable(null);
      }
    }
  }, [open, value?.table]);

  const renderTableItem = (table: string) => (
    <div
      key={table}
      className={cn(
        "flex items-center justify-between p-2 px-3 rounded-md hover:bg-accent/50 text-sm cursor-pointer transition-colors",
        selectedTable === table && "bg-accent"
      )}
      onClick={() => { setSelectedTable(table); }}
    >
      <span className="font-medium">{table}</span>
      <ChevronRight className="h-4 w-4 opacity-50" />
    </div>
  );

  const renderColumnItem = (col: TableColumn) => (
    <div
      key={`${col.table}.${col.column}`}
      className={cn(
        "flex items-center justify-between gap-2 p-2 px-3 rounded-md hover:bg-accent/50 text-sm cursor-pointer transition-colors",
        value?.table === col.table && value?.column === col.column && "bg-accent"
      )}
      onClick={() => { handleSelect(col.table, col.column); }}
    >
      <span className="font-mono font-medium">{col.column}</span>
      <span className="text-muted-foreground text-xs">{col.type}</span>
    </div>
  );

  return (
    <div className={cn("flex items-center justify-between gap-1 w-full", className)}>
      <Popover open={open && !disabled} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            className={cn(
              "justify-start text-xs font-mono px-2 h-7 flex-1",
              "hover:bg-transparent focus:bg-transparent",
              disabled && "opacity-60 cursor-not-allowed",
              !value && "text-muted-foreground"
            )}
          >
            {value ? (
              <div className="flex items-center gap-1">
                <span>{value.table}.{value.column}</span>
                <span className="text-muted-foreground">→</span>
              </div>
            ) : (
              <span>-</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-3" align="start">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search tables and columns..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); }}
                className="h-9 text-sm flex-1"
                autoFocus
              />
              {selectedTable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setSelectedTable(null); }}
                  className="h-9 px-3 text-sm font-medium"
                >
                  ← Back
                </Button>
              )}
            </div>

            {selectedTable && (
              <div className="text-sm text-muted-foreground font-medium px-1">
                Columns in {selectedTable}
              </div>
            )}

            <ScrollArea className="h-[280px]">
              {isLoading ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  Loading foreign key targets...
                </div>
              ) : selectedTable ? (
                <div className="space-y-1 pr-2">
                  {columnsForTable.map(renderColumnItem)}
                  {columnsForTable.length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-8">
                      No matching columns
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1 pr-2">
                  <div className="text-sm font-medium text-muted-foreground mb-2 px-1">
                    Select target table
                  </div>
                  {tables.map(renderTableItem)}
                  {tables.length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-8">
                      {search ? "No matching tables" : "No tables with primary keys found"}
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>
        </PopoverContent>
      </Popover>

      {value && !disabled && (
        <Button
          size="icon"
          variant="ghost"
          onClick={handleClear}
          className="h-5 w-5 p-0 hover:bg-destructive/10 hover:text-destructive mr-1"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
});