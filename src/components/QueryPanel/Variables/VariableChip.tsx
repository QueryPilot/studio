import { memo, useCallback } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IconSettings } from "@tabler/icons-react";
import type { QueryVariable, VariableType } from "@/lib/queryVariables/types";
import { VariableValueEditor } from "./VariableValueEditor";

interface VariableChipProps {
  variableKey: string;
  variable: QueryVariable;
  onValueChange: (key: string, value: string) => void;
  onTypeChange: (key: string, type: VariableType) => void;
}

export const VariableChip = memo(function VariableChip({
  variableKey: varKey,
  variable,
  onValueChange,
  onTypeChange,
}: VariableChipProps) {
  const handleValueChange = useCallback(
    (value: string) => { onValueChange(varKey, value); },
    [varKey, onValueChange],
  );

  const handleTypeChange = useCallback(
    (type: VariableType) => { onTypeChange(varKey, type); },
    [varKey, onTypeChange],
  );

  const displayValue = variable.value
    ? variable.value.length > 16
      ? variable.value.slice(0, 16) + "\u2026"
      : variable.value
    : null;

  const isEmpty = !variable.value;

  return (
    <Popover>
      <PopoverTrigger
        className={
          "flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap transition-colors cursor-pointer " +
          (isEmpty
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
            : "border-border bg-muted/50 text-foreground hover:bg-muted")
        }
        title={`${variable.name}: ${variable.value || "(empty)"}`}
      >
        <IconSettings className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="font-mono font-medium">{variable.name}</span>
        {displayValue && (
          <>
            <span className="text-muted-foreground">:</span>
            <span className="text-muted-foreground truncate max-w-[120px]">{displayValue}</span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <VariableValueEditor
          name={variable.name}
          value={variable.value}
          type={variable.type}
          onValueChange={handleValueChange}
          onTypeChange={handleTypeChange}
          compact
        />
      </PopoverContent>
    </Popover>
  );
});
