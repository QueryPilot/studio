import { memo, useMemo, type ReactNode } from "react";
import { useTableFullStructure } from "@/hooks/useTableFullStructure";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface TableStructureProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  isView?: boolean;
  kind?: "Table" | "View" | "MaterializedView";
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const TableStructure = memo(function TableStructure({
  connectionId,
  database,
  table,
  schema,
  isView: _isView = false,
  kind: _kind,
  onActionsChange: _onActionsChange,
}: TableStructureProps) {
  const { structure, isLoading, error, refresh } = useTableFullStructure({
    connectionId,
    database,
    table,
    schema,
    options: {
      includeConstraints: true,
      includeForeignKeys: true,
    },
  });

  const columns = useMemo(() => structure?.columns ?? [], [structure?.columns]);
  const foreignKeys = useMemo(
    () => structure?.foreignKeys ?? [],
    [structure?.foreignKeys],
  );
  const constraints = useMemo(
    () => structure?.constraints ?? [],
    [structure?.constraints],
  );

  if (isLoading) {
    return <TableStructureSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 select-text">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load structure</h3>
        <p className="text-sm text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">No columns available for this object.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="min-w-full border-separate border-spacing-0">
        <thead className="sticky top-0 z-10 bg-muted border-b border-border">
          <tr className="text-xs" style={{ height: "28px" }}>
            <HeaderCell className="w-12">#</HeaderCell>
            <HeaderCell className="w-48">Column</HeaderCell>
            <HeaderCell className="w-48">Type</HeaderCell>
            <HeaderCell className="w-28">Nullable</HeaderCell>
            <HeaderCell className="w-40">Default</HeaderCell>
            <HeaderCell className="w-48">Foreign Key</HeaderCell>
            <HeaderCell className="w-48">Check</HeaderCell>
            <HeaderCell className="">Comment</HeaderCell>
          </tr>
        </thead>
        <tbody className="text-xs">
          {columns.map((column, index) => {
            const fkInfo = foreignKeys.find((fk) =>
              fk.columns.includes(column.name),
            );
            const checkConstraint = constraints.find((c) => {
              if ((c as any).columnName) {
                return (c as any).columnName === column.name;
              }
              if (!c.definition) return false;
              return new RegExp(`"?${column.name}"?`, "i").test(c.definition);
            });

            return (
              <tr
                key={column.name}
                className={cn(
                  "border-b border-border hover:bg-muted/40 transition-colors",
                  (column.is_pk || column.is_fk) && "bg-muted/20",
                )}
              >
                <Cell className="text-muted-foreground">{index + 1}</Cell>
                <Cell className="font-medium">
                  {column.name}
                  {column.is_pk && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-yellow-600">
                      PK
                    </span>
                  )}
                  {column.is_fk && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-purple-600">
                      FK
                    </span>
                  )}
                </Cell>
                <Cell className="font-mono text-xs text-foreground/80">
                  {column.db_type}
                </Cell>
                <Cell>{column.nullable ? "YES" : "NO"}</Cell>
                <Cell className="font-mono text-[11px]">
                  {column.default ?? ""}
                </Cell>
                <Cell className="text-[11px]">
                  {fkInfo
                    ? `${fkInfo.foreignTable}.${fkInfo.foreignColumns[0]}`
                    : ""}
                </Cell>
                <Cell className="text-[11px]">
                  {checkConstraint?.definition ?? ""}
                </Cell>
                <Cell className="text-[11px]">
                  {column.comment ?? ""}
                </Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-4 py-2 text-xs text-muted-foreground border-t">
        Last refreshed: {(structure as any)?.fetchedAt ? new Date((structure as any).fetchedAt as string | number | Date).toLocaleString() : "n/a"}
        <button
          type="button"
          onClick={() => refresh().catch(() => undefined)}
          className="ml-4 text-primary hover:underline"
        >
          Refresh
        </button>
      </div>
    </div>
  );
});

const HeaderCell = ({ children, className }: { children: ReactNode; className?: string }) => (
  <th
    className={cn(
      "text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80",
      className,
    )}
  >
    {children}
  </th>
);

const Cell = ({ children, className }: { children: ReactNode; className?: string }) => (
  <td className={cn("px-2 py-1 border-b border-r border-border", className)}>{children}</td>
);

const TableStructureSkeleton = memo(function TableStructureSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-4 mb-4">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-28" />
      </div>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-28" />
        </div>
      ))}
    </div>
  );
});

export default TableStructure;

