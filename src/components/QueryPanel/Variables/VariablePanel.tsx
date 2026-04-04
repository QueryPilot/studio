import { memo, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { IconX } from "@tabler/icons-react";
import type { QueryVariable, VariableScope, VariableType } from "@/lib/queryVariables/types";
import { isPositionalSyntax } from "@/lib/queryVariables/types";
import { VariableValueEditor } from "./VariableValueEditor";

interface VariablePanelProps {
  variables: Record<string, QueryVariable>;
  scope: VariableScope;
  statementCount: number;
  onScopeChange: (scope: VariableScope) => void;
  onValueChange: (key: string, value: string) => void;
  onTypeChange: (key: string, type: VariableType) => void;
  onClose: () => void;
}

export const VariablePanel = memo(function VariablePanel({
  variables,
  scope,
  statementCount,
  onScopeChange,
  onValueChange,
  onTypeChange,
  onClose,
}: VariablePanelProps) {
  const allEntries = useMemo(
    () => Object.entries(variables),
    [variables],
  );

  const groups = useMemo(() => {
    if (scope !== "per_statement" || statementCount <= 1) {
      const named = allEntries.filter(([, v]) => !isPositionalSyntax(v.syntax));
      const positional = allEntries.filter(([, v]) => isPositionalSyntax(v.syntax));
      return { mode: "global" as const, named, positional };
    }

    const byStmt = new Map<number, Array<[string, QueryVariable]>>();
    for (const entry of allEntries) {
      const stmtIdx = entry[1].statementIndex ?? 0;
      const existing = byStmt.get(stmtIdx) ?? [];
      existing.push(entry);
      byStmt.set(stmtIdx, existing);
    }

    const stmtGroups = Array.from(byStmt.entries())
      .sort(([a], [b]) => a - b)
      .map(([idx, entries]) => ({ label: `Statement ${idx + 1}`, entries }));

    return { mode: "per_statement" as const, stmtGroups };
  }, [allEntries, scope, statementCount]);

  const isEmpty = allEntries.length === 0;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-muted/30">
      {/* Title bar with scope toggle inlined */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/50 shrink-0">
        <span className="text-xs font-medium text-muted-foreground shrink-0">Variables</span>

        <div className="flex items-center gap-1.5">
          {statementCount > 1 && (
            <div className="inline-flex items-center rounded-md bg-muted p-0.5 text-[11px]">
              <button
                type="button"
                className={
                  "rounded px-2 py-0.5 transition-colors " +
                  (scope === "global"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
                onClick={() => { onScopeChange("global"); }}
              >
                Global
              </button>
              <button
                type="button"
                className={
                  "rounded px-2 py-0.5 transition-colors " +
                  (scope === "per_statement"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
                onClick={() => { onScopeChange("per_statement"); }}
              >
                Per-stmt
              </button>
            </div>
          )}

          <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close Variables">
            <IconX className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3 py-2 space-y-3">
        {isEmpty && (
          <p className="text-xs text-muted-foreground italic py-4 text-center">
            No variables detected in the query.
          </p>
        )}

        {groups.mode === "global" ? (
          <>
            {groups.named.length > 0 && (
              <section>
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Named Variables
                </h4>
                <div className="space-y-3">
                  {groups.named.map(([key, variable]) => (
                    <VariableValueEditor
                      key={key}
                      name={variable.name}
                      value={variable.value}
                      type={variable.type}
                      onValueChange={(val) => { onValueChange(key, val); }}
                      onTypeChange={(type) => { onTypeChange(key, type); }}
                      compact
                    />
                  ))}
                </div>
              </section>
            )}

            {groups.positional.length > 0 && (
              <section>
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Positional Parameters
                </h4>
                <div className="space-y-3">
                  {groups.positional.map(([key, variable]) => (
                    <VariableValueEditor
                      key={key}
                      name={variable.name}
                      value={variable.value}
                      type={variable.type}
                      onValueChange={(val) => { onValueChange(key, val); }}
                      onTypeChange={(type) => { onTypeChange(key, type); }}
                      compact
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          groups.stmtGroups.map((group) => (
            <section key={group.label}>
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {group.label}
              </h4>
              <div className="space-y-3">
                {group.entries.map(([key, variable]) => (
                  <VariableValueEditor
                    key={key}
                    name={variable.name}
                    value={variable.value}
                    type={variable.type}
                    onValueChange={(val) => { onValueChange(key, val); }}
                    onTypeChange={(type) => { onTypeChange(key, type); }}
                    compact
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
});
