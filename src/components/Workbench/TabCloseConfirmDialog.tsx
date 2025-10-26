import { memo, useMemo } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTableEditStore } from "@/stores/tableEditStore";
import { createScopeKey } from "@/stores/tableEditStore";
import type { TabMetadata } from "@/types/workbench";

interface TabCloseConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  metadata: TabMetadata | undefined;
  connectionId: string;
}

export const TabCloseConfirmDialog = memo(
  function TabCloseConfirmDialog({
    open,
    onOpenChange,
    onConfirm,
    metadata,
    connectionId,
  }: TabCloseConfirmDialogProps) {
    const discardScope = useTableEditStore((state) => state.discardScope);

    // Calculate total pending changes for this tab
    const pendingChanges = useMemo(() => {
      if (!metadata || metadata.type === "query" || !metadata.table) {
        return { total: 0, byDomain: {} };
      }

      const scopeKey = createScopeKey({
        connectionId,
        database: metadata.database || "",
        schema: metadata.schema || "public",
        table: metadata.table,
      });

      const scopeState =
        useTableEditStore.getState().scopes.get(scopeKey);

      if (!scopeState) {
        return { total: 0, byDomain: {} };
      }

      const summary = scopeState.summary;
      return {
        total: summary.totalChanges,
        byDomain: summary.byDomain,
      };
    }, [metadata, connectionId]);

    const handleConfirm = () => {
      if (metadata && metadata.type !== "query" && metadata.table) {
        const scopeKey = createScopeKey({
          connectionId,
          database: metadata.database || "",
          schema: metadata.schema || "public",
          table: metadata.table,
        });

        // Discard pending changes for this scope
        discardScope(scopeKey);
      }

      onConfirm();
    };

    if (pendingChanges.total === 0) {
      return null;
    }

    const tableName = metadata?.table || "this table";
    const changeDetails = [];

    if (pendingChanges.byDomain.data > 0) {
      changeDetails.push(`${pendingChanges.byDomain.data} data change(s)`);
    }
    if (pendingChanges.byDomain.structure > 0) {
      changeDetails.push(
        `${pendingChanges.byDomain.structure} structure change(s)`,
      );
    }
    if (pendingChanges.byDomain.indexes > 0) {
      changeDetails.push(
        `${pendingChanges.byDomain.indexes} index change(s)`,
      );
    }
    if (pendingChanges.byDomain.triggers > 0) {
      changeDetails.push(
        `${pendingChanges.byDomain.triggers} trigger change(s)`,
      );
    }

    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have {pendingChanges.total} unsaved change
              {pendingChanges.total !== 1 ? "s" : ""} for <strong>{tableName}</strong>:
              <ul className="list-disc list-inside mt-2 space-y-1">
                {changeDetails.map((detail, i) => (
                  <li key={i}>{detail}</li>
                ))}
              </ul>
              <div className="mt-3 text-foreground">
                Closing this tab will discard all pending changes. This action
                cannot be undone.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  },
);

