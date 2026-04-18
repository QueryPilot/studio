import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { Attachment } from "@/types/connection";
import { vaultStorage } from "@/services/vaultStorage";
import { useRuntimeDatabasesStore } from "@/stores/runtimeDatabasesStore";

interface DuckDbAttachmentsPanelProps {
  connectionId: string;
}

/**
 * Phase 3: Panel for managing persisted DuckDB attachments.
 * Lists profile.databases[0].attachments and provides Add / Remove actions.
 */
export function DuckDbAttachmentsPanel({ connectionId }: DuckDbAttachmentsPanelProps) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);
  const runtimeStore = useRuntimeDatabasesStore();

  const { data: storedConn, isLoading } = useQuery({
    queryKey: ["stored-connection", connectionId],
    queryFn: () => vaultStorage.getConnection(connectionId),
    staleTime: 10_000,
  });

  const attachments: Attachment[] = storedConn?.profile.databases[0]?.attachments ?? [];

  async function handleRemove(alias: string) {
    if (removing) return;
    setRemoving(alias);
    try {
      await invoke("duckdb_run_detach", { connId: connectionId, alias });
      runtimeStore.removeDatabase(connectionId, alias);
      // Remove from profile
      const conn = await vaultStorage.getConnection(connectionId);
      if (conn) {
        const db0 = conn.profile.databases[0];
        if (db0) {
          const nextAttachments = (db0.attachments ?? []).filter((a) => a.alias !== alias);
          await vaultStorage.updateConnection(connectionId, {
            ...conn.profile,
            databases: [{ ...db0, attachments: nextAttachments }],
          });
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["stored-connection", connectionId] });
    } catch (err) {
      console.error("Failed to remove attachment:", err);
    } finally {
      setRemoving(null);
    }
  }

  if (isLoading) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">Loading attachments…</div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="text-xs font-medium text-muted-foreground mb-1">
        Persisted Attachments
      </div>
      {attachments.length === 0 && (
        <div className="text-xs text-muted-foreground px-1">
          No persisted attachments. Use the DuckDB toolbar to attach databases or catalogs and check
          "Save to this connection".
        </div>
      )}
      {attachments.map((att) => (
        <div
          key={att.alias}
          className="flex items-center justify-between px-2 py-1 rounded bg-muted/30 text-xs"
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-medium truncate">{att.alias}</span>
            <span className="text-muted-foreground truncate">
              {att.kind} · {att.uri}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-destructive hover:text-destructive"
            onClick={() => { void handleRemove(att.alias); }}
            disabled={removing === att.alias}
          >
            {removing === att.alias ? "Detaching…" : "Remove"}
          </Button>
        </div>
      ))}
    </div>
  );
}
