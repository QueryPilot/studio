import { memo, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { IconX } from "@tabler/icons-react";
import type { QueryVariable, VariableScope, VariableType } from "@/lib/queryVariables/types";
import { isPositionalSyntax } from "@/lib/queryVariables/types";
import { VariableValueEditor } from "./VariableValueEditor";

interface VariablePanelProps {
  variables: Record<string, QueryVariable>;
  hasPositionalVariables: boolean;
  scope: VariableScope;
  statementCount: number;
  onScopeChange: (scope: VariableScope) => void;
  onValueChange: (key: string, value: string) => void;
  onTypeChange: (key: string, type: VariableType) => void;
  onClose: () => void;
}

export const VariablePanel = memo(function VariablePanel({
  variables,
  hasPositionalVariables,
  scope,
  statementCount,
  onScopeChange,
  onValueChange,
  onTypeChange,
  onClose,
}: VariablePanelProps) {
  const { named, positional } = useMemo(() => {
    const namedVars: Array<[string, QueryVariable]> = [];
    const positionalVars: Array<[string, QueryVariable]> = [];

    for (const [key, variable] of Object.entries(variables)) {
      if (isPositionalSyntax(variable.syntax)) {
        positionalVars.push([key, variable]);
      } else {
        namedVars.push([key, variable]);
      }
    }

    return { named: namedVars, positional: positionalVars };
  }, [variables]);

  const positionalGroups = useMemo(() => {
    if (scope !== "per_statement" || statementCount <= 1) {
      return [{ label: null, entries: positional }];
    }

    const groups = new Map<number, Array<[string, QueryVariable]>>();
    for (const entry of positional) {
      const stmtIdx = entry[1].statementIndex ?? 0;
      const existing = groups.get(stmtIdx) ?? [];
      existing.push(entry);
      groups.set(stmtIdx, existing);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => a - b)
      .map(([idx, entries]) => ({
        label: `Statement ${idx + 1}`,
        entries,
      }));
  }, [positional, scope, statementCount]);

  const isEmpty = named.length === 0 && positional.length === 0;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-muted/30">
      {/* Title bar with scope toggle inlined */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/50 shrink-0">
        <span className="text-xs font-medium text-muted-foreground shrink-0">Variables</span>

        <div className="flex items-center gap-1.5">
          {hasPositionalVariables && (
            <div className="inline-flex items-center rounded-md bg-muted p-0.5 text-[10px]">
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

        {named.length > 0 && (
          <section>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Named Variables
            </h4>
            <div className="space-y-3">
              {named.map(([key, variable]) => (
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

        {positional.length > 0 && (
          <section>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Positional Parameters
            </h4>
            {positionalGroups.map((group, groupIdx) => (
              <div key={group.label ?? "all"} className={groupIdx > 0 ? "mt-3" : ""}>
                {group.label && (
                  <div className="text-[10px] text-muted-foreground mb-1.5 font-medium">
                    {group.label}
                  </div>
                )}
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
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
});
