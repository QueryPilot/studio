import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Zap } from "lucide-react";
import { databaseService, type TriggerMeta } from "@/services/databaseService";
import { cn } from "@/lib/utils";

interface TableTriggersProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const TableTriggers = memo(function TableTriggers({
  connectionId,
  database,
  table,
  schema,
  onActionsChange,
}: TableTriggersProps) {
  const [triggers, setTriggers] = useState<TriggerMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!onActionsChange) return;
    onActionsChange(null);
    return () => {
      onActionsChange(null);
    };
  }, [onActionsChange]);

  const loadTriggers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await databaseService.listTriggers(
        connectionId,
        database,
        schema || "public",
        table,
      );
      setTriggers(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load triggers");
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, database, schema, table]);

  useEffect(() => {
    void loadTriggers();
  }, [loadTriggers]);

  const hasTriggers = useMemo(() => triggers.length > 0, [triggers.length]);

  if (isLoading) {
    return <TableTriggersSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 select-text">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load triggers</h3>
        <p className="text-sm text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  if (!hasTriggers) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Zap className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-sm">This table has no triggers.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-muted border-b border-border">
            <tr className="text-xs" style={{ height: "28px" }}>
              <HeaderCell className="w-12">#</HeaderCell>
              <HeaderCell className="w-48">Name</HeaderCell>
              <HeaderCell className="w-40">Event</HeaderCell>
              <HeaderCell className="w-32">Timing</HeaderCell>
              <HeaderCell className="w-32">Level</HeaderCell>
              <HeaderCell className="w-24">Enabled</HeaderCell>
              <HeaderCell className="w-60">Function</HeaderCell>
              <HeaderCell className="">Condition</HeaderCell>
            </tr>
          </thead>
          <tbody className="text-xs">
            {triggers.map((trigger, idx) => (
              <tr
                key={trigger.name}
                className="border-b border-border hover:bg-muted/40 transition-colors"
              >
                <Cell className="text-muted-foreground">{idx + 1}</Cell>
                <Cell className="font-medium">{trigger.name}</Cell>
                <Cell className="font-mono text-[11px]">
                  {trigger.event}
                </Cell>
                <Cell>{trigger.timing}</Cell>
                <Cell>{trigger.level}</Cell>
                <Cell>{trigger.enabled ? "YES" : "NO"}</Cell>
                <Cell className="font-mono text-[11px]">
                  {trigger.function}
                </Cell>
                <Cell className="font-mono text-[11px]">
                  {trigger.condition ?? ""}
                </Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-xs text-muted-foreground border-t">
        Total triggers: {triggers.length}
        <button
          type="button"
          onClick={() => loadTriggers().catch(() => undefined)}
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

const TableTriggersSkeleton = memo(function TableTriggersSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-4 mb-4">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-28" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
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

export default TableTriggers;

