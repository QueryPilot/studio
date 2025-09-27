import { memo } from "react";
import { cn } from "@/lib/utils";
import { KeyRound, Hash, Trash2, Link, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColumnSelector } from "./ColumnSelector";
import { IndexTypeSelector } from "./IndexTypeSelector";
import { IndexSizeCell } from "./IndexSizeCell";
import { IndexUsageCell } from "./IndexUsageCell";
import { ConstraintInput } from "../ConstraintInput";
import { type IndexUsageStats } from "@/services/backend";

interface Column {
  name: string;
  db_type: string;
}

export interface IndexRowData {
  name: string;
  columns: string[];
  unique: boolean;
  type: string;
  condition: string;
  originalName?: string;
  primary?: boolean;
  size?: string;
  foreign_key?: boolean;
}

interface IndexRowProps {
  index: IndexRowData;
  rowNumber: number;
  hasChanges?: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
  originalIndex?: IndexRowData;
  connectionId?: string;
  availableColumns: Column[];
  usageStats?: Map<string, IndexUsageStats>;
  statsLoading?: boolean;
  onUpdate?: (updates: Partial<IndexRowData>) => void;
  onToggleUnique?: () => void;
  onDelete?: () => void;
  onReset?: () => void;
  className?: string;
}

export const IndexRow = memo(function IndexRow({
  index,
  rowNumber,
  hasChanges = false,
  isNew = false,
  isDeleted = false,
  originalIndex,
  connectionId,
  availableColumns,
  usageStats,
  statsLoading = false,
  onUpdate,
  onToggleUnique,
  onDelete,
  onReset,
  className,
}: IndexRowProps) {
  const isPrimary = index.primary;
  const isForeignKey = index.foreign_key;
  const canEdit = !isPrimary && !isForeignKey;

  // Debug logging
  if (index.name === "idx_todos_user_id") {
    console.log("idx_todos_user_id data:", {
      name: index.name,
      foreign_key: index.foreign_key,
      isPrimary,
      isForeignKey,
      canEdit,
    });
  }

  // Check individual field changes
  const nameChanged = originalIndex && index.name !== originalIndex.name;
  const columnsChanged =
    originalIndex &&
    JSON.stringify(index.columns) !== JSON.stringify(originalIndex.columns);
  const typeChanged = originalIndex && index.type !== originalIndex.type;
  const conditionChanged =
    originalIndex && index.condition !== originalIndex.condition;

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
    return cn("bg-background hover:bg-background/50");
  };

  return (
    <tr
      className={cn(
        "group transition-colors text-xs",
        getRowClassName(),
        className,
      )}
    >
      <td className="border-r border-b border-border text-muted-foreground px-2 py-1 w-10">
        {isNew ? "-" : rowNumber}
      </td>

      <td className="border-r border-b border-border font-medium text-foreground/80 dark:text-foreground/70 min-w-[150px]">
        <div
          className={cn(
            "flex items-center justify-between relative",
            nameChanged && canEdit && "bg-primary/10 rounded-sm",
          )}
        >
          <input
            value={index.name}
            onChange={(e) => canEdit && onUpdate?.({ name: e.target.value })}
            placeholder={isNew ? "idx_table_column" : undefined}
            disabled={!canEdit}
            className={cn(
              "!px-2 !py-1 !h-7 !w-full bg-transparent border-0 outline-none !text-xs",
              {
                "!pr-6": index.unique || isPrimary || isForeignKey,
                "focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary":
                  canEdit,
                "cursor-not-allowed opacity-60 font-semibold": !canEdit,
                "text-primary": nameChanged && canEdit,
                "placeholder:text-muted-foreground/50 placeholder:text-xs":
                  isNew,
              },
            )}
          />
          <div className="flex items-center gap-1 px-1 absolute right-1">
            {isPrimary && (
              <span title="Primary Key">
                <KeyRound className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
              </span>
            )}
            {isForeignKey && (
              <span title="Foreign Key Index">
                <Link className="h-3 w-3 text-purple-600 dark:text-purple-500" />
              </span>
            )}
            {index.unique && !isPrimary && !isForeignKey && (
              <span title="Unique Index">
                <Hash className="h-3 w-3 text-blue-600 dark:text-blue-500" />
              </span>
            )}
          </div>
        </div>
      </td>

      <td className="border-r border-b border-border text-foreground/80 dark:text-foreground/65 font-mono text-xs min-w-[200px]">
        <div
          className={cn(
            columnsChanged && canEdit && "bg-primary/10 rounded-sm",
          )}
        >
          <ColumnSelector
            value={index.columns}
            onChange={(cols) => canEdit && onUpdate?.({ columns: cols })}
            availableColumns={availableColumns}
            placeholder={isNew ? "Select columns..." : undefined}
            disabled={!canEdit}
            className={cn(
              "w-full !h-7 border-0 bg-transparent",
              canEdit &&
                "hover:bg-muted/50 focus-within:ring-1 focus-within:ring-primary",
              !canEdit && "opacity-60 cursor-not-allowed",
              columnsChanged && canEdit
                ? "text-primary"
                : "text-foreground/80 dark:text-foreground/70",
            )}
          />
        </div>
      </td>

      <td className="border-r border-b border-border text-foreground/80 dark:text-foreground/65 min-w-[100px] px-1">
        <div className={cn(typeChanged && "bg-primary/10 rounded-sm")}>
          <IndexTypeSelector
            value={index.type}
            onChange={(val) => onUpdate?.({ type: val })}
            connectionId={connectionId}
            isEditing={canEdit}
            disabled={isPrimary}
            size="small"
            className={cn(
              "w-full",
              typeChanged && "text-primary font-semibold",
            )}
          />
        </div>
      </td>

      <td className="px-1 py-0.5 border-r border-b border-border min-w-[70px]">
        <button
          onClick={onToggleUnique}
          disabled={isPrimary}
          className={cn(
            "inline-flex w-full h-5 rounded !text-xs cursor-pointer transition-colors px-1 items-center justify-center",
            !canEdit && "cursor-not-allowed opacity-50",
            index.unique
              ? isNew
                ? "bg-emerald-600/20 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 hover:bg-emerald-600/30"
                : conditionChanged
                ? "bg-primary/20 text-primary hover:bg-primary/30"
                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/40"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700",
          )}
        >
          {index.unique ? "YES" : "NO"}
        </button>
      </td>

      <td className="border-r border-b border-border text-foreground/60 dark:text-foreground/50 text-xs min-w-[150px]">
        <div
          className={cn(
            conditionChanged && canEdit && "bg-primary/10 rounded-sm",
          )}
        >
          {canEdit ? (
            <ConstraintInput
              value={index.condition || ""}
              onChange={(val) => onUpdate?.({ condition: val || "" })}
              placeholder={isNew ? "Optional WHERE" : "WHERE clause"}
              disabled={!canEdit}
              isNew={isNew}
              className={cn(conditionChanged && "text-primary")}
              label="WHERE Condition"
              availableColumns={availableColumns}
            />
          ) : (
            <span className="italic px-2 py-1 h-7 flex items-center">
              {index.condition || "-"}
            </span>
          )}
        </div>
      </td>

      <td className="border-r border-b border-border text-right px-2 min-w-[70px]">
        {!isNew && (
          <IndexSizeCell
            indexName={index.originalName || index.name}
            size={index.size}
            usageStats={usageStats}
            isLoading={statsLoading}
          />
        )}
        {isNew && <span className="text-muted-foreground text-xs">-</span>}
      </td>

      <td className="px-2 py-1 border-b border-border min-w-[100px]">
        <div className="flex items-center justify-between relative">
          {!isNew ? (
            <IndexUsageCell
              indexName={index.originalName || index.name}
              usageStats={usageStats}
              isLoading={statsLoading}
            />
          ) : (
            <span className="text-muted-foreground text-xs">-</span>
          )}
          {canEdit && (
            <div className="absolute right-2">
              {/* Show undo button when deleted or has changes */}
              {(isDeleted || hasChanges) && onReset && (
                <Button
                  size="icon"
                  variant={isDeleted ? "default" : "ghost"}
                  onClick={onReset}
                  title={isDeleted ? "Undo delete" : "Reset changes"}
                  className={cn(
                    "h-5 w-5 transition-all ml-auto",
                    isDeleted
                      ? "opacity-100 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      : "opacity-0 group-hover:opacity-100 hover:bg-muted",
                  )}
                >
                  <Undo2 className="h-3 w-3" />
                </Button>
              )}
              {/* Only show delete button when not deleted */}
              {!isDeleted && onDelete && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onDelete}
                  title="Delete index"
                  className={cn(
                    "h-5 w-5 transition-all ml-auto",
                    "opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive",
                  )}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
});
