import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { KeyRound, Hash, Link, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { TypeSelector } from "./TypeSelector";
import { DefaultValueInput } from "./DefaultValueInput";
import { ForeignKeyEditorPopover } from "./ForeignKeyEditorPopover";

export interface ColumnRowData {
  name: string;
  db_type: string;
  nullable: boolean;
  default?: string | null;
  is_pk?: boolean;
  is_fk?: boolean;
  check_constraint?: string | null;
  foreign_key_ref?: {
    table: string;
    column: string;
    onUpdate?: string;
    onDelete?: string;
  } | null;
  comment?: string | null;
  originalName?: string;
}

interface ColumnRowProps {
  column: ColumnRowData;
  rowNumber: number;
  hasChanges?: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
  originalColumn?: ColumnRowData;
  connectionId?: string;
  onUpdate?: (updates: Partial<ColumnRowData>) => void;
  onDelete?: () => void;
  onReset?: () => void;
  className?: string;
}

export const ColumnRow = memo(function ColumnRow({
  column,
  rowNumber,
  hasChanges = false,
  isNew = false,
  isDeleted = false,
  originalColumn,
  connectionId,
  onUpdate,
  onDelete,
  onReset,
  className,
}: ColumnRowProps) {
  const isPrimary = column.is_pk;
  const isForeignKey = column.is_fk;
  const canEdit = !isPrimary; // Allow editing even for FK columns (except primary keys)
  const canEditName = canEdit && (isNew || !isPrimary); // Allow name edit for new columns and non-PK columns

  // Check individual field changes
  const nameChanged = originalColumn && column.name !== originalColumn.name;
  const typeChanged =
    originalColumn && column.db_type !== originalColumn.db_type;
  const nullableChanged =
    originalColumn && column.nullable !== originalColumn.nullable;
  const defaultChanged =
    originalColumn && column.default !== originalColumn.default;
  const checkChanged =
    originalColumn &&
    column.check_constraint !== originalColumn.check_constraint;
  const foreignKeyChanged =
    originalColumn &&
    JSON.stringify(column.foreign_key_ref) !==
      JSON.stringify(originalColumn.foreign_key_ref);
  const commentChanged =
    originalColumn && column.comment !== originalColumn.comment;

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
          className={cn(
            "flex items-center justify-between relative",
            nameChanged && canEditName && "bg-primary/10 rounded-sm",
          )}
        >
          {canEditName ? (
            <Input
              value={column.name}
              onChange={(e) => onUpdate?.({ name: e.target.value })}
              placeholder={isNew ? "column_name" : undefined}
              className={cn(
                "!h-7 px-2 py-1 border-0 bg-transparent !text-xs",
                "focus-visible:ring-1 focus-visible:ring-primary rounded-none !bg-transparent",
                nameChanged && "text-primary",
                isNew && "placeholder:text-muted-foreground/50",
                {
                  "pr-8":
                    column.is_pk || isForeignKey || column.check_constraint,
                },
              )}
            />
          ) : (
            <span className={cn(column.is_pk && "font-semibold", "px-2")}>
              {column.name}
            </span>
          )}
          <div className="flex items-center gap-1 px-1 absolute right-0">
            {isPrimary && (
              <span title="Primary Key">
                <KeyRound className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
              </span>
            )}
            {isForeignKey && (
              <span title="Foreign Key">
                <Link className="h-3 w-3 text-purple-600 dark:text-purple-500" />
              </span>
            )}
            {!isPrimary && !isForeignKey && column.check_constraint && (
              <span title="Check Constraint">
                <Hash className="h-3 w-3 text-blue-600 dark:text-blue-500" />
              </span>
            )}
          </div>
        </div>
      </td>

      <td className="border-b border-r border-border text-foreground/80 dark:text-foreground/65 font-mono text-xs min-w-[200px] p-0">
        <div
          className={cn(
            "h-7 flex items-center",
            typeChanged && canEdit && "bg-primary/10",
          )}
        >
          <TypeSelector
            value={column.db_type}
            onChange={(val) => canEdit && onUpdate?.({ db_type: val })}
            connectionId={connectionId}
            disabled={!canEdit}
            className={cn("w-full", typeChanged && canEdit && "text-primary")}
          />
        </div>
      </td>

      <td className="px-2 py-1 border-b border-r border-border min-w-[80px] relative">
        <button
          onClick={() => canEdit && onUpdate?.({ nullable: !column.nullable })}
          disabled={!canEdit || isPrimary}
          className={cn(
            "inline-flex w-full h-5 rounded !text-xs cursor-pointer transition-colors px-1 items-center justify-center ",
            !canEdit && "cursor-not-allowed opacity-50",
            column.nullable
              ? isNew
                ? "bg-emerald-600/20 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 hover:bg-emerald-600/30"
                : nullableChanged
                ? "bg-primary/20 text-primary hover:bg-primary/30"
                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/40"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700",
          )}
        >
          {column.nullable ? "YES" : "NO"}
        </button>
      </td>

      <td className="border-b border-r border-border text-foreground/70 dark:text-foreground/60 text-xs min-w-[100px]">
        <div
          className={cn(
            defaultChanged && canEdit && "bg-primary/10 rounded-sm",
          )}
        >
          <DefaultValueInput
            value={column.default}
            onChange={(val) => canEdit && onUpdate?.({ default: val })}
            columnType={column.db_type}
            disabled={!canEdit}
            placeholder={isNew ? "NULL" : undefined}
            className={cn(defaultChanged && canEdit && "text-primary")}
          />
        </div>
      </td>

      <td className="border-b border-r border-border text-foreground/70 dark:text-foreground/60 text-xs min-w-[100px]">
        <div
          className={cn(checkChanged && canEdit && "bg-primary/10 rounded-sm")}
        >
          {canEdit ? (
            <Input
              value={column.check_constraint || ""}
              onChange={(e) =>
                onUpdate?.({ check_constraint: e.target.value || null })
              }
              placeholder={isNew ? "expression" : "-"}
              className={cn(
                "!h-7 !px-2 !py-1 border-0 bg-transparent !text-xs font-mono text-ellipsis",
                "focus-visible:ring-1 focus-visible:ring-primary rounded-none !bg-transparent",
                checkChanged && "text-primary",
                isNew && "placeholder:text-muted-foreground/50",
              )}
            />
          ) : (
            <span
              className="font-mono text-xs px-2"
              title={column.check_constraint || undefined}
            >
              {column.check_constraint ? (
                <>
                  {column.check_constraint.substring(0, 30)}
                  {column.check_constraint.length > 30 && "..."}
                </>
              ) : (
                "-"
              )}
            </span>
          )}
        </div>
      </td>

      <td className="border-b border-r border-border text-foreground/70 dark:text-foreground/60 text-xs min-w-[150px]">
        <div
          className={cn(
            "flex items-center",
            foreignKeyChanged && canEdit && "bg-primary/10 rounded-sm",
          )}
        >
          <ForeignKeyEditorPopover
            value={column.foreign_key_ref}
            onChange={(val) => onUpdate?.({ foreign_key_ref: val })}
            connectionId={connectionId}
            currentTable={originalColumn?.name}
            currentColumn={column.name}
            columnName={column.name}
            disabled={!canEdit || isPrimary}
          />
        </div>
      </td>

      <td className="border-b border-r border-border text-foreground/60 dark:text-foreground/50 text-xs min-w-[200px]">
        <div
          className={cn(
            "flex items-center justify-between",
            commentChanged && canEdit && "bg-primary/10 rounded-sm",
          )}
        >
          {canEdit ? (
            <Input
              value={column.comment || ""}
              onChange={(e) => onUpdate?.({ comment: e.target.value })}
              placeholder={isNew ? "Column description" : "-"}
              className={cn(
                "!h-7 !px-2 !py-1 border-0 bg-transparent !text-xs italic flex-1",
                "focus-visible:ring-1 focus-visible:ring-primary rounded-none !bg-transparent",
                commentChanged && "text-primary",
                isNew && "placeholder:text-muted-foreground/50",
              )}
            />
          ) : (
            <span className="italic px-2">{column.comment || "-"}</span>
          )}
          {canEdit && (
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
                  title="Delete column"
                  className={cn(
                    "h-5 w-5 transition-all ml-1",
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
