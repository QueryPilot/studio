import React from "react";
import { cn } from "@/lib/utils";

const PALETTE = [
  "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-700",
  "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-700",
  "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700",
  "bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-700",
  "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-700",
  "bg-cyan-100 text-cyan-900 border-cyan-300 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-700",
  "bg-lime-100 text-lime-900 border-lime-300 dark:bg-lime-950 dark:text-lime-300 dark:border-lime-700",
  "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-300 dark:bg-fuchsia-950 dark:text-fuchsia-300 dark:border-fuchsia-700",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function schemaTintClass(schema: string): string {
  return PALETTE[hash(schema) % PALETTE.length] ?? PALETTE[0] ?? "";
}

interface ERDSchemaLegendProps {
  schemas: string[];
  tableCounts: Record<string, number>;
  className?: string;
}

export const ERDSchemaLegend: React.FC<ERDSchemaLegendProps> = ({
  schemas,
  tableCounts,
  className,
}) => {
  if (schemas.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5 px-2 py-1 text-xs", className)}>
      {schemas.map((schema) => (
        <span
          key={schema}
          className={cn(
            "inline-flex items-center rounded-md border px-1.5 py-0.5",
            schemaTintClass(schema),
          )}
          data-schema={schema}
        >
          {schema} ({tableCounts[schema] ?? 0})
        </span>
      ))}
    </div>
  );
};
