import {
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuCheckboxItem,
  ContextMenuGroup,
} from "@/components/ui/context-menu";
import { IconLink, IconX } from "@tabler/icons-react";
import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useEmbeddedFKPreferencesStore } from "../stores";
import type { GridColumnV2 } from "../types";

interface FKEmbedSubmenuProps {
  column: GridColumnV2;
  connectionId: string;
  schema: string;
  table: string;
  referencedTableColumns?: Array<{ name: string; db_type: string }>;
}

const SUGGESTED_COLUMN_NAMES = [
  "name", "title", "label", "display_name",
  "email", "username", "code",
  "description", "summary",
];

export function FKEmbedSubmenu({
  column,
  connectionId,
  schema,
  table,
  referencedTableColumns,
}: FKEmbedSubmenuProps) {
  const storageKey = useMemo(
    () => `${connectionId}:${schema}.${table}`,
    [connectionId, schema, table]
  );

  const columnName = column.name;

  const setEmbeddedColumns = useEmbeddedFKPreferencesStore(
    (state) => state.setEmbeddedColumns
  );
  const clearEmbeddedColumn = useEmbeddedFKPreferencesStore(
    (state) => state.clearEmbeddedColumn
  );

  // Use useShallow to prevent re-renders from array reference changes
  const embeddedColumns = useEmbeddedFKPreferencesStore(
    useShallow((state) => state.preferences[storageKey]?.embeddedColumns[columnName] ?? [])
  );

  const metaWithFk = column.meta as { fk_reference?: unknown } | undefined;
  const fkRef = metaWithFk?.fk_reference;
  if (!fkRef) return null;

  // Promote selected columns and name-matched columns into the suggested section
  const isSuggested = (col: { name: string }) =>
    embeddedColumns.includes(col.name) ||
    SUGGESTED_COLUMN_NAMES.some(name =>
      col.name.toLowerCase().includes(name.toLowerCase())
    );

  const suggestedColumns = referencedTableColumns?.filter(isSuggested) ?? [];
  const otherColumns = referencedTableColumns?.filter(col => !isSuggested(col)) ?? [];

  const handleToggleColumn = (refColumnName: string) => {
    const current = embeddedColumns;
    if (current.includes(refColumnName)) {
      const updated = current.filter(c => c !== refColumnName);
      if (updated.length === 0) {
        clearEmbeddedColumn(storageKey, columnName);
      } else {
        setEmbeddedColumns(storageKey, columnName, updated);
      }
    } else {
      setEmbeddedColumns(storageKey, columnName, [...current, refColumnName]);
    }
  };

  const handleClear = () => {
    clearEmbeddedColumn(storageKey, columnName);
  };

  const hasEmbedded = embeddedColumns.length > 0;

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="py-1.5 px-2 flex items-center">
        <IconLink className="mr-2 h-4 w-4 shrink-0" />
        <span>Embed Reference Value</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-56 w-auto max-w-80 !text-xs p-1.5">
        {suggestedColumns.length > 0 ? (
          <>
            <ContextMenuGroup>
              <ContextMenuLabel className="text-xs text-muted-foreground py-1 px-2">
                Suggested
              </ContextMenuLabel>
              {suggestedColumns.map((col) => (
                <ContextMenuCheckboxItem
                  key={col.name}
                  checked={embeddedColumns.includes(col.name)}
                  onCheckedChange={() => { handleToggleColumn(col.name); }}
                  onSelect={(e) => { e.preventDefault(); }}
                  className="py-1.5 flex justify-between w-full"
                >
                  <span className="shrink-0">{col.name}</span>
                  <span className="ml-auto text-muted-foreground/60 font-mono text-[10px] truncate max-w-[140px] text-right">
                    {col.db_type}
                  </span>
                </ContextMenuCheckboxItem>
              ))}
            </ContextMenuGroup>
            {otherColumns.length > 0 && (
              <>
                <ContextMenuSeparator />
                <ContextMenuSub>
                  <ContextMenuSubTrigger className="py-1.5 px-2">
                    More columns...
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="max-h-60 overflow-y-auto min-w-56 w-auto max-w-80 !text-xs p-1.5">
                    {otherColumns.map((col) => (
                      <ContextMenuCheckboxItem
                        key={col.name}
                        checked={embeddedColumns.includes(col.name)}
                        onCheckedChange={() => { handleToggleColumn(col.name); }}
                        onSelect={(e) => { e.preventDefault(); }}
                        className="py-1.5 flex justify-between w-full"
                      >
                        <span className="shrink-0">{col.name}</span>
                        <span className="ml-auto text-muted-foreground/60 font-mono text-[10px] truncate max-w-[140px] text-right">
                          {col.db_type}
                        </span>
                      </ContextMenuCheckboxItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </>
            )}
          </>
        ) : (
          /* No suggestions — show all columns directly in a flat scrollable list */
          <div className="max-h-60 overflow-y-auto">
            {otherColumns.map((col) => (
              <ContextMenuCheckboxItem
                key={col.name}
                checked={embeddedColumns.includes(col.name)}
                onCheckedChange={() => { handleToggleColumn(col.name); }}
                onSelect={(e) => { e.preventDefault(); }}
                className="py-1.5 flex justify-between w-full"
              >
                <span className="shrink-0">{col.name}</span>
                <span className="ml-auto text-muted-foreground/60 font-mono text-[10px] truncate max-w-[140px] text-right">
                  {col.db_type}
                </span>
              </ContextMenuCheckboxItem>
            ))}
          </div>
        )}

        {hasEmbedded && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={handleClear}
              className="py-1.5 px-2 flex items-center text-destructive"
            >
              <IconX className="mr-2 h-4 w-4 shrink-0" />
              <span>Clear Embedded</span>
            </ContextMenuItem>
          </>
        )}

        {!referencedTableColumns?.length && (
          <ContextMenuItem disabled className="py-1.5 px-2 text-muted-foreground">
            Loading columns...
          </ContextMenuItem>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
