import { memo } from "react";
import { cn } from "@/lib/utils";
import { Clock, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EventSelector } from "./EventSelector";
import { TimingSelector } from "./TimingSelector";
import { LevelSelector } from "./LevelSelector";
import { FunctionSelector } from "./FunctionSelector";
import { ConstraintInput } from "../ConstraintInput";

export interface TriggerRowData {
  name: string;
  event: string;
  timing: string;
  level: string;
  enabled: boolean;
  function: string;
  condition?: string;
  originalName?: string;
}

interface TriggerRowProps {
  trigger: TriggerRowData;
  rowNumber: number;
  hasChanges?: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
  originalTrigger?: TriggerRowData;
  availableColumns?: Array<{ name: string; db_type?: string }>;
  availableFunctions?: string[];
  onUpdate?: (updates: Partial<TriggerRowData>) => void;
  onToggleEnabled?: () => void;
  onDelete?: () => void;
  onReset?: () => void;
  className?: string;
}

export const TriggerRow = memo(function TriggerRow({
  trigger,
  rowNumber,
  hasChanges = false,
  isNew = false,
  isDeleted = false,
  originalTrigger,
  availableColumns = [],
  availableFunctions = [],
  onUpdate,
  onToggleEnabled,
  onDelete,
  onReset,
  className,
}: TriggerRowProps) {
  // Check individual field changes
  const nameChanged = originalTrigger && trigger.name !== originalTrigger.name;
  const eventChanged =
    originalTrigger && trigger.event !== originalTrigger.event;
  const timingChanged =
    originalTrigger && trigger.timing !== originalTrigger.timing;
  const levelChanged =
    originalTrigger && trigger.level !== originalTrigger.level;
  const functionChanged =
    originalTrigger && trigger.function !== originalTrigger.function;
  const conditionChanged =
    originalTrigger && trigger.condition !== originalTrigger.condition;
  const enabledChanged =
    originalTrigger && trigger.enabled !== originalTrigger.enabled;

  const getRowClassName = () => {
    if (isDeleted) {
      return "bg-destructive/10 hover:bg-destructive/15 opacity-75";
    }
    if (isNew) {
      return "bg-green-50 dark:bg-green-900/20 hover:bg-green-50 dark:hover:bg-green-900/30";
    }
    if (hasChanges) {
      return "bg-primary/5 hover:bg-primary/10";
    }
    return "";
  };

  return (
    <tr
      className={cn(
        "group transition-colors text-xs",
        getRowClassName(),
        className,
      )}
      style={{ height: "28px" }}
    >
      <td className="px-2 py-1 border-b border-r border-border text-muted-foreground">
        {isNew ? "-" : rowNumber}
      </td>

      <td className="border-b border-r border-border font-medium text-foreground/80 dark:text-foreground/70 min-w-[150px]">
        <div
          className={cn("relative", nameChanged && "bg-primary/10 rounded-sm")}
        >
          <Input
            value={trigger.name}
            onChange={(e) => onUpdate?.({ name: e.target.value })}
            placeholder={isNew ? "trigger_name" : undefined}
            disabled={!isNew && !nameChanged}
            className={cn(
              "!h-7 px-2 py-1 border-0 bg-transparent !text-xs",
              "focus-visible:ring-1 focus-visible:ring-primary rounded-none",
              nameChanged && "text-primary",
              isNew && "placeholder:text-muted-foreground/50",
              !trigger.enabled && "line-through opacity-60",
            )}
          />
        </div>
      </td>

      <td className="border-b border-r border-border text-foreground/80 dark:text-foreground/65 min-w-[100px]">
        <div className={cn(eventChanged && "bg-primary/10 rounded-sm")}>
          <EventSelector
            value={trigger.event}
            onChange={(val) => onUpdate?.({ event: val })}
            disabled={false}
            className={cn("w-full", eventChanged && "text-primary")}
          />
        </div>
      </td>

      <td className="border-b border-r border-border text-foreground/80 dark:text-foreground/65 min-w-[100px]">
        <div
          className={cn(
            "flex items-center gap-1",
            timingChanged && "bg-primary/10 rounded-sm",
          )}
        >
          <TimingSelector
            value={trigger.timing}
            onChange={(val) => onUpdate?.({ timing: val })}
            disabled={false}
            className={cn("flex-1", timingChanged && "text-primary")}
          />
        </div>
      </td>

      <td className="border-b border-r border-border text-foreground/80 dark:text-foreground/65 min-w-[80px]">
        <div className={cn(levelChanged && "bg-primary/10 rounded-sm")}>
          <LevelSelector
            value={trigger.level}
            onChange={(val) => onUpdate?.({ level: val })}
            disabled={false}
            className={cn("w-full", levelChanged && "text-primary")}
          />
        </div>
      </td>

      <td className="px-1 py-0.5 border-r border-b border-border min-w-[100px]">
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleEnabled}
            className={cn(
              "inline-flex w-full h-5 rounded !text-xs cursor-pointer transition-colors px-1 items-center justify-center",
              trigger.enabled
                ? isNew || enabledChanged
                  ? "bg-primary/20 text-primary hover:bg-primary/30"
                  : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/40"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700",
            )}
          >
            {trigger.enabled ? "ENABLED" : "DISABLED"}
          </button>
        </div>
      </td>

      <td className="border-b border-r border-border text-foreground/70 dark:text-foreground/60 text-xs min-w-[150px] max-w-[250px]">
        <div
          className={cn(
            functionChanged && "bg-primary/10 rounded-sm",
            "w-full",
          )}
        >
          <FunctionSelector
            value={trigger.function}
            onChange={(val) => onUpdate?.({ function: val })}
            placeholder={isNew ? "Select function..." : "Select function..."}
            availableFunctions={availableFunctions}
            disabled={false}
            className={cn(functionChanged && "text-primary", "w-full")}
          />
        </div>
      </td>

      <td className="border-b text-foreground/60 dark:text-foreground/50 text-xs min-w-[150px]">
        <div
          className={cn(
            "flex items-center justify-between relative",
            conditionChanged && "bg-primary/10 rounded-sm",
          )}
        >
          <ConstraintInput
            value={trigger.condition || ""}
            onChange={(val) => onUpdate?.({ condition: val || undefined })}
            placeholder={isNew ? "Optional WHEN" : "WHEN clause"}
            disabled={false}
            isNew={isNew}
            className={cn(conditionChanged && "text-primary", "flex-1")}
            label="WHEN Condition"
            availableColumns={availableColumns}
          />
          <div className="absolute right-2">
            {(isDeleted || hasChanges) && onReset && (
              <Button
                size="icon"
                variant={isDeleted ? "default" : "ghost"}
                onClick={onReset}
                title={isDeleted ? "Undo delete" : "Reset changes"}
                className={cn(
                  "h-5 w-5 transition-all ml-2",
                  isDeleted
                    ? "opacity-100 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : "opacity-0 group-hover:opacity-100 hover:bg-muted",
                )}
              >
                <Undo2 className="h-3 w-3" />
              </Button>
            )}
            {!isDeleted && onDelete && (
              <Button
                size="icon"
                variant="ghost"
                onClick={onDelete}
                title="Delete trigger"
                className={cn(
                  "h-5 w-5 transition-all ml-1",
                  "opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive",
                )}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
});
