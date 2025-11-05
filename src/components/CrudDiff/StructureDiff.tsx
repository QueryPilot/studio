import { Badge } from "@/components/ui/badge";
import type { StructureDiffEntry } from "@/types/crud";
import { cn } from "@/lib/cn";

interface StructureDiffProps {
  readonly entries: StructureDiffEntry[];
  readonly className?: string;
}

const changeVariant = (changeType: StructureDiffEntry['changeType']): Parameters<typeof Badge>[0]['variant'] => {
  switch (changeType) {
    case 'added':
      return 'default';
    case 'removed':
      return 'destructive';
    case 'modified':
    default:
      return 'secondary';
  }
};

export function StructureDiff({ entries, className }: StructureDiffProps) {
  if (!entries.length) {
    return (
      <div className={cn("flex h-full items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground", className)}>
        No schema changes staged for this table.
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {entries.map((entry) => (
        <div key={`${entry.path}-${entry.changeType}`} className="rounded-lg border bg-background p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Badge variant={changeVariant(entry.changeType)} className="capitalize">
              {entry.changeType}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">{entry.path}</span>
          </div>
          <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
            {entry.before && (
              <DiffBlock title="Before" value={entry.before} tone="muted" />
            )}
            {entry.after && <DiffBlock title="After" value={entry.after} tone="default" />}
          </div>
        </div>
      ))}
    </div>
  );
}

interface DiffBlockProps {
  readonly title: string;
  readonly value: unknown;
  readonly tone?: 'muted' | 'default';
}

function DiffBlock({ title, value, tone = 'default' }: DiffBlockProps) {
  return (
    <div className={cn("rounded-md border px-3 py-2", tone === 'muted' ? 'bg-muted/40' : 'bg-card')}>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

