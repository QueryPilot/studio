import { useState, useEffect } from "react";
import { Table2, Database } from "lucide-react";
import { cn } from "@/lib/utils";

interface TableItem {
  name: string;
  schema?: string;
  type: 'table' | 'view';
  columns?: number;
}

interface TableMentionPopupProps {
  isOpen: boolean;
  searchQuery: string;
  position: { top: number; left: number };
  onSelect: (table: TableItem) => void;
  tables?: TableItem[];
}

const MOCK_TABLES: TableItem[] = [
  { name: 'users', schema: 'public', type: 'table', columns: 8 },
  { name: 'orders', schema: 'public', type: 'table', columns: 12 },
  { name: 'products', schema: 'public', type: 'table', columns: 10 },
  { name: 'customers', schema: 'public', type: 'table', columns: 7 },
  { name: 'categories', schema: 'public', type: 'table', columns: 4 },
  { name: 'user_sessions', schema: 'public', type: 'table', columns: 6 },
  { name: 'order_items', schema: 'public', type: 'table', columns: 8 },
  { name: 'inventory', schema: 'public', type: 'table', columns: 9 },
  { name: 'payments', schema: 'public', type: 'table', columns: 11 },
  { name: 'reviews', schema: 'public', type: 'table', columns: 7 },
  { name: 'active_users_view', schema: 'public', type: 'view', columns: 5 },
  { name: 'sales_summary_view', schema: 'public', type: 'view', columns: 8 },
];

export function TableMentionPopup({
  isOpen,
  searchQuery,
  position,
  onSelect,
  tables = MOCK_TABLES
}: TableMentionPopupProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filteredTables, setFilteredTables] = useState<TableItem[]>(tables);

  useEffect(() => {
    const query = searchQuery.toLowerCase();
    const filtered = tables.filter((table) =>
      table.name.toLowerCase().includes(query)
    );
    setFilteredTables(filtered);
    setSelectedIndex(0);
  }, [searchQuery, tables]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredTables.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredTables[selectedIndex]) {
            onSelect(filteredTables[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); };
  }, [isOpen, selectedIndex, filteredTables, onSelect]);

  if (!isOpen || filteredTables.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute z-50 w-72 max-h-64 overflow-hidden rounded-lg border bg-popover shadow-lg"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <div className="overflow-y-auto max-h-64">
        <div className="py-1">
          {filteredTables.map((table, index) => (
            <div
              key={`${table.schema}.${table.name}`}
              className={cn(
                "flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors",
                selectedIndex === index
                  ? "bg-accent"
                  : "hover:bg-accent/50"
              )}
              onClick={() => { onSelect(table); }}
              onMouseEnter={() => { setSelectedIndex(index); }}
            >
              <div className="flex-shrink-0">
                {table.type === 'view' ? (
                  <Database className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Table2 className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="font-medium text-sm truncate">
                    {table.name}
                  </span>
                  {table.schema && (
                    <span className="text-xs text-muted-foreground">
                      ({table.schema})
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {table.type} • {table.columns} columns
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}