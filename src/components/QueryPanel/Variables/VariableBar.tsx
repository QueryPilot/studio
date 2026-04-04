import { memo } from "react";
import type { QueryVariable, VariableScope, VariableType } from "@/lib/queryVariables/types";
import { isPositionalSyntax } from "@/lib/queryVariables/types";
import { VariableChip } from "./VariableChip";

interface VariableBarProps {
  variables: Record<string, QueryVariable>;
  hasPositionalVariables: boolean;
  scope: VariableScope;
  onScopeChange: (scope: VariableScope) => void;
  onValueChange: (key: string, value: string) => void;
  onTypeChange: (key: string, type: VariableType) => void;
}

export const VariableBar = memo(function VariableBar({
  variables,
  hasPositionalVariables,
  scope,
  onScopeChange,
  onValueChange,
  onTypeChange,
}: VariableBarProps) {
  const entries = Object.entries(variables);
  if (entries.length === 0) return null;

  const sorted = [...entries].sort(([, a], [, b]) => {
    const aPos = isPositionalSyntax(a.syntax) ? 1 : 0;
    const bPos = isPositionalSyntax(b.syntax) ? 1 : 0;
    return aPos - bPos;
  });

  return (
    <div className="flex items-center gap-1 px-1.5 py-1 bg-muted/10 border-t border-border/50">
      <div className="flex items-center gap-1 min-w-0 flex-1 flex-wrap">
        {sorted.map(([key, variable]) => (
          <VariableChip
            key={key}
            variableKey={key}
            variable={variable}
            onValueChange={onValueChange}
            onTypeChange={onTypeChange}
          />
        ))}
      </div>

      {hasPositionalVariables && (
        <div className="shrink-0 flex items-center border-l border-border/50 pl-1.5 ml-1 sticky right-0 bg-muted/10">
          <div className="inline-flex items-center rounded-md bg-muted p-0.5 text-[11px]">
            <button
              type="button"
              className={
                "rounded px-1.5 py-0.5 transition-colors " +
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
                "rounded px-1.5 py-0.5 transition-colors " +
                (scope === "per_statement"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
              onClick={() => { onScopeChange("per_statement"); }}
            >
              Per-stmt
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
