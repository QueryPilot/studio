import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CrudDiffConflict, CrudImpactSummary } from "@/types/crud";
import { cn } from "@/lib/cn";

interface ImpactSummaryProps {
  readonly impacts: CrudImpactSummary[];
  readonly conflicts: CrudDiffConflict[];
  readonly className?: string;
}

const severityAccent: Record<CrudImpactSummary['severity'], string> = {
  info: 'border-border',
  warning: 'border-amber-500/50',
  error: 'border-destructive/50',
};

export function ImpactSummary({ impacts, conflicts, className }: ImpactSummaryProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {conflicts.length > 0 && (
        <div className="space-y-2">
          {conflicts.map((conflict) => (
            <Alert
              key={conflict.id}
              variant={conflict.severity === 'error' ? 'destructive' : 'default'}
            >
              <AlertTitle className="flex items-center justify-between">
                <span>{conflict.message}</span>
              </AlertTitle>
              {conflict.resolutionHint && (
                <AlertDescription className="mt-1 text-xs text-muted-foreground">
                  {conflict.resolutionHint}
                </AlertDescription>
              )}
            </Alert>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {impacts.map((impact, index) => (
          <Card key={index} className={cn('border-l-4', severityAccent[impact.severity])}>
            <CardHeader>
              <CardTitle className="text-sm font-semibold capitalize">
                {impact.type}
              </CardTitle>
              <CardDescription className="text-xs capitalize text-muted-foreground">
                Severity: {impact.severity}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-foreground">{impact.message}</p>
              {impact.details && (
                <pre className="mt-3 overflow-x-auto rounded bg-muted/60 p-3 text-[11px] text-muted-foreground">
                  {JSON.stringify(impact.details, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

