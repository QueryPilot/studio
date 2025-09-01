import { memo, useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Clock, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { databaseService, type TriggerMeta } from "@/services/databaseService";

interface TableTriggersProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

export const TableTriggers = memo(function TableTriggers({
  connectionId,
  database,
  table,
  schema,
}: TableTriggersProps) {
  const [triggers, setTriggers] = useState<TriggerMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTriggers = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await databaseService.listTriggers(
          connectionId,
          database,
          schema || "public",
          table,
        );
        setTriggers(result);
      } catch (err) {
        console.error("Failed to fetch triggers:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load triggers",
        );
      } finally {
        setIsLoading(false);
      }
    };

    if (connectionId && database && table) {
      void fetchTriggers();
    }
  }, [connectionId, database, table, schema]);

  if (isLoading) {
    return <TableTriggersSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load triggers</h3>
        <p className="text-sm text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full">
        <thead className="sticky top-0 z-10 bg-muted/50 border-b">
          <tr className="text-xs" style={{ height: "28px" }}>
            <th className="text-left px-2 py-1 w-10 border-r font-normal text-foreground/70">
              #
            </th>
            <th className="text-left px-2 py-1 border-r font-normal text-foreground/70">
              Trigger Name
            </th>
            <th className="text-left px-2 py-1 border-r font-normal text-foreground/70">
              Event
            </th>
            <th className="text-left px-2 py-1 border-r font-normal text-foreground/70">
              Timing
            </th>
            <th className="text-left px-2 py-1 border-r font-normal text-foreground/70">
              Level
            </th>
            <th className="text-left px-2 py-1 border-r font-normal text-foreground/70">
              Status
            </th>
            <th className="text-left px-2 py-1 border-r font-normal text-foreground/70">
              Function
            </th>
            <th className="text-left px-2 py-1 border-r font-normal text-foreground/70">
              Condition
            </th>
          </tr>
        </thead>
        <tbody>
          {triggers.map((trigger, i) => (
            <tr
              key={trigger.name}
              className={cn(
                "hover:bg-primary/10 transition-colors text-xs border-b border-r",
                i % 2 === 0 && "bg-muted/10",
              )}
              style={{ height: "28px" }}
            >
              <td className="px-1.5 py-0.5 border-r text-muted-foreground">
                {i + 1}
              </td>
              <td className="px-1.5 py-0.5 border-r font-medium text-foreground/80 dark:text-foreground/70">
                <span
                  className={!trigger.enabled ? "line-through opacity-60" : ""}
                >
                  {trigger.name}
                </span>
              </td>
              <td className="px-1.5 py-0.5 border-r">
                <span
                  className={cn(
                    "inline-flex px-1.5 py-0 rounded text-xs font-mono",
                    trigger.event === "INSERT" &&
                      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                    trigger.event === "UPDATE" &&
                      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                    trigger.event === "DELETE" &&
                      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                    trigger.event === "TRUNCATE" &&
                      "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
                  )}
                >
                  {trigger.event}
                </span>
              </td>
              <td className="px-1.5 py-0.5 border-r text-foreground/80 dark:text-foreground/65">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{trigger.timing}</span>
                  {trigger.timing === "BEFORE" && (
                    <Clock className="h-3 w-3 text-blue-600 dark:text-blue-500 opacity-70" />
                  )}
                </div>
              </td>
              <td className="px-1.5 py-0.5 border-r text-foreground/80 dark:text-foreground/65 font-mono text-xs">
                {trigger.level}
              </td>
              <td className="px-1.5 py-0.5 border-r">
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-flex px-1.5 py-0 rounded text-xs",
                      trigger.enabled
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
                    )}
                  >
                    {trigger.enabled ? "ENABLED" : "DISABLED"}
                  </span>
                  {trigger.enabled ? (
                    <Play className="h-3 w-3 text-green-600 dark:text-green-500 opacity-70" />
                  ) : (
                    <Pause className="h-3 w-3 text-gray-600 dark:text-gray-500 opacity-70" />
                  )}
                </div>
              </td>
              <td className="px-1.5 py-0.5 border-r text-foreground/70 dark:text-foreground/60 font-mono text-xs">
                {trigger.function}
              </td>
              <td className="px-1.5 py-0.5 border-r text-foreground/60 dark:text-foreground/50 text-xs italic">
                {trigger.condition || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

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
