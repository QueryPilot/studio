import { memo } from "react";
import { useTableStructure } from "@/hooks/useTableStructure";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, KeyRound, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

interface TableStructureProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

export const TableStructure = memo(function TableStructure({
  connectionId,
  database,
  table,
  schema,
}: TableStructureProps) {
  const { columns, isLoading, error } = useTableStructure({
    connectionId,
    database,
    table,
    schema,
  });

  if (isLoading) {
    return <TableStructureSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load structure</h3>
        <p className="text-sm text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="h-full overflow-auto">
        <table className="w-full table-fixed">
        <thead className="sticky top-0 z-10 bg-background border-b">
          <tr className="text-xs font-semibold text-foreground/85 dark:text-foreground/75" style={{ height: "32px" }}>
            <th className="text-left px-1.5 py-0.5 w-[40px]">#</th>
            <th className="text-left px-1.5 py-0.5 w-[150px]">Column</th>
            <th className="text-left px-1.5 py-0.5 w-[120px]">Type</th>
            <th className="text-left px-1.5 py-0.5 w-[90px]">Nullable</th>
            <th className="text-left px-1.5 py-0.5 w-[180px]">Default</th>
            <th className="text-left px-1.5 py-0.5 w-[80px]">Check</th>
            <th className="text-left px-1.5 py-0.5 w-[140px]">Foreign Key</th>
            <th className="text-left px-1.5 py-0.5 w-auto">Comment</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column, index) => (
            <tr
              key={column.name}
              className={cn(
                "hover:bg-primary/10 transition-colors text-xs",
                index % 2 === 0 && "bg-muted/10",
                index < columns.length - 1 ? "border-b" : "border-b-2",
              )}
              style={{ height: "28px" }}
            >
              <td className="px-1.5 py-0.5 text-muted-foreground">{index + 1}</td>
              <td className="px-1.5 py-0.5 font-medium text-foreground/80 dark:text-foreground/70">
                <div className="flex items-center justify-between">
                  <span className={column.is_pk ? "font-semibold" : ""}>
                    {column.name}
                  </span>
                  <div className="flex items-center gap-1">
                    {column.is_pk && (
                      <KeyRound className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
                    )}
                    {column.is_fk && (
                      <Hash className="h-3 w-3 text-blue-600 dark:text-blue-500" />
                    )}
                  </div>
                </div>
              </td>
              <td className="px-1.5 py-0.5 text-foreground/80 dark:text-foreground/65 font-mono text-xs">
                {column.db_type}
              </td>
              <td className="px-1.5 py-0.5">
                <span
                  className={cn(
                    "inline-flex px-1.5 py-0 rounded text-xs",
                    column.nullable
                      ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
                  )}
                >
                  {column.nullable ? "NULL" : "NOT NULL"}
                </span>
              </td>
              <td className="px-1.5 py-0.5 text-foreground/70 dark:text-foreground/60 text-xs">
                {column.default && column.default.length > 25 ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="truncate cursor-help">
                        {column.default}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[400px] break-all">
                      <p className="font-mono text-xs">{column.default}</p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div className="truncate">
                    {column.default || "-"}
                  </div>
                )}
              </td>
              <td className="px-1.5 py-0.5 text-foreground/70 dark:text-foreground/60 text-xs">
                -
              </td>
              <td className="px-1.5 py-0.5 text-foreground/70 dark:text-foreground/60 text-xs">
                {column.is_fk ? (
                  <div className="flex items-center justify-between font-mono">
                    <span>{column.name.replace(/_id$/, '')}s.id</span>
                    <span>→</span>
                  </div>
                ) : (
                  "-"
                )}
              </td>
              <td className="px-1.5 py-0.5 text-foreground/60 dark:text-foreground/50 text-xs italic">
                -
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </TooltipProvider>
  );
});

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
