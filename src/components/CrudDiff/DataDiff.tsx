import { Fragment } from "react";

import { Badge } from "@/components/ui/badge";
import type { DataRowDiff } from "@/types/crud";
import { cn } from "@/lib/cn";

interface DataDiffProps {
  readonly rows: DataRowDiff[];
  readonly className?: string;
}

const EMPTY_STATE = "No staged row changes for this table.";

const formatDictionary = (record?: Record<string, unknown>): string => {
  if (!record || Object.keys(record).length === 0) {
    return "—";
  }

  return Object.entries(record)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
};

const operationVariant = (
  operation?: DataRowDiff["operation"],
): Parameters<typeof Badge>[0]["variant"] => {
  switch (operation) {
    case "insert":
      return "default";
    case "delete":
      return "destructive";
    case "update":
      return "secondary";
    default:
      return "outline";
  }
};

export function DataDiff({ rows, className }: DataDiffProps) {
  if (!rows.length) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center rounded-xl border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground",
          className,
        )}
      >
        {EMPTY_STATE}
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border", className)}>
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/60">
          <tr>
            <th
              scope="col"
              className="px-4 py-2 text-left font-medium text-muted-foreground"
            >
              Operation
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-left font-medium text-muted-foreground"
            >
              Primary Key
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-left font-medium text-muted-foreground"
            >
              Before
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-left font-medium text-muted-foreground"
            >
              After
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-background">
          {rows.map((row, index) => (
            <tr
              key={`${row.operation ?? "row"}-${index}`}
              className="align-top"
            >
              <td className="px-4 py-3">
                <Badge
                  variant={operationVariant(row.operation)}
                  className="capitalize"
                >
                  {row.operation ?? "pending"}
                </Badge>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {formatDictionary(row.primaryKey)}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                <DiffDictionary value={row.before} />
              </td>
              <td className="px-4 py-3">
                <DiffDictionary value={row.after} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DiffDictionaryProps {
  readonly value?: Record<string, unknown>;
}

function DiffDictionary({ value }: DiffDictionaryProps) {
  if (!value || Object.keys(value).length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const entries = Object.entries(value);

  return (
    <dl className="grid gap-1 text-xs leading-5">
      {entries.map(([key, rawValue]) => (
        <Fragment key={key}>
          <dt className="font-medium text-foreground">{key}</dt>
          <dd className="rounded bg-muted/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {typeof rawValue === "object" && rawValue !== null
              ? JSON.stringify(rawValue)
              : String(rawValue)}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
