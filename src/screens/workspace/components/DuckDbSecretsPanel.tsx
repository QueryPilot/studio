import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { IconTrash, IconPlus, IconSearch, IconKey } from "@tabler/icons-react";
import { toast } from "sonner";
import {
  BackendAPI,
  type DuckDbSecretInfo,
  type DuckDbCreateSecretRequest,
} from "@/services/backend";
import { DuckDbCreateSecretDialog } from "./DuckDbCreateSecretDialog";

interface DuckDbSecretsPanelProps {
  open: boolean;
  onClose: () => void;
  connectionId: string;
}

function DeleteSecretConfirm({
  open,
  secretName,
  onCancel,
  onConfirm,
  isDeleting,
}: {
  open: boolean;
  secretName: string;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Drop Secret</DialogTitle>
          <DialogDescription>
            Are you sure you want to drop the secret{" "}
            <span className="font-mono font-semibold">{secretName}</span>? This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Dropping..." : "Drop Secret"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DuckDbSecretsPanel({
  open,
  onClose,
  connectionId,
}: DuckDbSecretsPanelProps) {
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DuckDbSecretInfo | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    data: secrets = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["duckdb-secrets", connectionId],
    queryFn: () => BackendAPI.duckdbListSecrets(connectionId),
    enabled: open,
  });

  const filteredSecrets =
    search.trim().length > 0
      ? secrets.filter(
          (s) =>
            s.name.toLowerCase().includes(search.toLowerCase()) ||
            s.secretType.toLowerCase().includes(search.toLowerCase()) ||
            s.provider.toLowerCase().includes(search.toLowerCase()),
        )
      : secrets;

  const handleCreateSecret = async (request: DuckDbCreateSecretRequest) => {
    setIsCreating(true);
    try {
      await BackendAPI.duckdbCreateSecret(connectionId, request);
      toast.success(`Secret "${request.name}" created`);
      await queryClient.invalidateQueries({
        queryKey: ["duckdb-secrets", connectionId],
      });
      setCreateDialogOpen(false);
    } catch (err) {
      toast.error("Failed to create secret", {
        description: String(err),
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDropSecret = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await BackendAPI.duckdbDropSecret(
        connectionId,
        pendingDelete.name,
        pendingDelete.persistent,
      );
      toast.success(`Secret "${pendingDelete.name}" dropped`);
      await queryClient.invalidateQueries({
        queryKey: ["duckdb-secrets", connectionId],
      });
      setPendingDelete(null);
    } catch (err) {
      toast.error("Failed to drop secret", {
        description: String(err),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconKey className="h-4 w-4" />
              Secrets Manager
            </DialogTitle>
            <DialogDescription>
              Manage credentials for accessing remote storage like S3, GCS, or
              Azure.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {secrets.length > 5 && (
                <div className="relative flex-1">
                  <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); }}
                    placeholder="Filter secrets..."
                    className="pl-8 h-8 text-xs"
                  />
                </div>
              )}
              <Button
                size="sm"
                onClick={() => { setCreateDialogOpen(true); }}
                className="ml-auto"
              >
                <IconPlus className="h-3.5 w-3.5 mr-1.5" />
                Add Secret
              </Button>
            </div>

            {isLoading && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading secrets...
              </div>
            )}

            {error && (
              <div className="py-8 text-center text-sm text-destructive">
                Failed to load secrets: {String(error)}
              </div>
            )}

            {!isLoading && !error && secrets.length === 0 && (
              <div className="py-10 text-center space-y-2">
                <IconKey className="h-8 w-8 mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No secrets configured.
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Add a secret to access remote storage like S3, GCS, or Azure.
                </p>
              </div>
            )}

            {!isLoading && !error && filteredSecrets.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-3 py-2 font-medium">Name</th>
                      <th className="text-left px-3 py-2 font-medium">Type</th>
                      <th className="text-left px-3 py-2 font-medium">
                        Provider
                      </th>
                      <th className="text-left px-3 py-2 font-medium">
                        Scope
                      </th>
                      <th className="text-left px-3 py-2 font-medium w-20">
                        Storage
                      </th>
                      <th className="text-right px-3 py-2 font-medium w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSecrets.map((secret) => (
                      <tr
                        key={secret.name}
                        className="border-b last:border-b-0 hover:bg-muted/30"
                      >
                        <td className="px-3 py-2 font-mono font-medium">
                          {secret.name}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {secret.secretType}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {secret.provider}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground font-mono truncate max-w-[150px]">
                          {secret.scope.length > 0
                            ? secret.scope.join(", ")
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Badge
                            variant={
                              secret.persistent ? "default" : "secondary"
                            }
                            className="text-[10px]"
                          >
                            {secret.persistent ? "persistent" : "temporary"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            onClick={() => { setPendingDelete(secret); }}
                            title={`Drop secret ${secret.name}`}
                          >
                            <IconTrash className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!isLoading &&
              !error &&
              secrets.length > 0 &&
              filteredSecrets.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No secrets match your filter.
                </div>
              )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DuckDbCreateSecretDialog
        open={createDialogOpen}
        onClose={() => { setCreateDialogOpen(false); }}
        onSubmit={(req) => { void handleCreateSecret(req); }}
        isSubmitting={isCreating}
      />

      <DeleteSecretConfirm
        open={pendingDelete !== null}
        secretName={pendingDelete?.name ?? ""}
        onCancel={() => { setPendingDelete(null); }}
        onConfirm={() => { void handleDropSecret(); }}
        isDeleting={isDeleting}
      />
    </>
  );
}
