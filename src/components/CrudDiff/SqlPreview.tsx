import { logger } from "@/lib/logger";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SqlDiffStatement } from "@/types/crud";
import { cn } from "@/lib/cn";

interface SqlPreviewProps {
  readonly statements: SqlDiffStatement[];
  readonly className?: string;
}

export function SqlPreview({ statements, className }: SqlPreviewProps) {
  if (!statements.length) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center rounded-xl border border-dashed border-muted-foreground/40 p-6 text-xs text-muted-foreground",
          className,
        )}
      >
        No SQL statements generated for the staged changes.
      </div>
    );
  }

  return (
    <ScrollArea className={cn("max-h-[480px] rounded-xl border", className)}>
      <div className="divide-y divide-border">
        {statements.map((statement) => (
          <SqlStatementPanel key={statement.id} statement={statement} />
        ))}
      </div>
    </ScrollArea>
  );
}

interface SqlStatementPanelProps {
  readonly statement: SqlDiffStatement;
}

function SqlStatementPanel({ statement }: SqlStatementPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(statement.statement);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (error) {
      logger.error("Failed to copy SQL statement", error);
    }
  }, [statement.statement]);

  return (
    <article className="space-y-3 bg-background p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Command</span>:{" "}
          {statement.commandId}
        </div>
        <Button variant="ghost" onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </header>
      <pre className="overflow-auto rounded-md bg-muted/60 p-3 text-xs leading-6">
        <code>{statement.statement}</code>
      </pre>
    </article>
  );
}
