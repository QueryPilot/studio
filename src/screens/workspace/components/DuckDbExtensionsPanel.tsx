import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  IconSearch,
  IconRefresh,
  IconPuzzle,
  IconDownload,
  IconPlayerPlay,
  IconLoader2,
  IconCircleCheck,
  IconStar,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { BackendAPI, type DuckDbExtensionInfo } from "@/services/backend";

const RECOMMENDED_EXTENSIONS = new Set([
  "httpfs",
  "json",
  "parquet",
  "spatial",
  "fts",
  "iceberg",
  "delta",
  "excel",
  "vss",
  "postgres_scanner",
  "mysql_scanner",
  "sqlite_scanner",
]);

type ExtensionStatus = "loaded" | "installed" | "available";

function getStatus(ext: DuckDbExtensionInfo): ExtensionStatus {
  if (ext.loaded) return "loaded";
  if (ext.installed) return "installed";
  return "available";
}

function statusOrder(status: ExtensionStatus): number {
  switch (status) {
    case "loaded":
      return 0;
    case "installed":
      return 1;
    case "available":
      return 2;
  }
}

function sortExtensions(extensions: DuckDbExtensionInfo[]): DuckDbExtensionInfo[] {
  return [...extensions].sort((a, b) => {
    const sa = statusOrder(getStatus(a));
    const sb = statusOrder(getStatus(b));
    if (sa !== sb) return sa - sb;
    const aRec = RECOMMENDED_EXTENSIONS.has(a.extensionName) ? 0 : 1;
    const bRec = RECOMMENDED_EXTENSIONS.has(b.extensionName) ? 0 : 1;
    if (aRec !== bRec) return aRec - bRec;
    return a.extensionName.localeCompare(b.extensionName);
  });
}

interface DuckDbExtensionsPanelProps {
  open: boolean;
  onClose: () => void;
  connectionId: string;
}

function StatusBadge({ status }: { status: ExtensionStatus }) {
  switch (status) {
    case "loaded":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 text-[10px] gap-1">
          <IconCircleCheck className="h-3 w-3" />
          Loaded
        </Badge>
      );
    case "installed":
      return (
        <Badge variant="secondary" className="text-[10px] gap-1">
          Installed
        </Badge>
      );
    case "available":
      return (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          Available
        </Badge>
      );
  }
}

function ExtensionRow({
  ext,
  onInstall,
  onLoad,
  actionInProgress,
}: {
  ext: DuckDbExtensionInfo;
  onInstall: (name: string) => void;
  onLoad: (name: string) => void;
  actionInProgress: string | null;
}) {
  const status = getStatus(ext);
  const isActing = actionInProgress === ext.extensionName;
  const isRecommended = RECOMMENDED_EXTENSIONS.has(ext.extensionName);

  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/30">
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-medium text-xs">
            {ext.extensionName}
          </span>
          {isRecommended && (
            <Tooltip>
              <TooltipTrigger>
                <IconStar className="h-3 w-3 text-amber-500 flex-shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="top">Recommended extension</TooltipContent>
            </Tooltip>
          )}
        </div>
        {ext.description && (
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
            {ext.description}
          </p>
        )}
        {ext.installPath && status !== "available" && (
          <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono truncate max-w-[300px]">
            {ext.installPath}
          </p>
        )}
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={status} />
      </td>
      <td className="px-3 py-2 text-right">
        {status === "available" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            disabled={actionInProgress !== null}
            onClick={() => onInstall(ext.extensionName)}
          >
            {isActing ? (
              <IconLoader2 className="h-3 w-3 animate-spin" />
            ) : (
              <IconDownload className="h-3 w-3" />
            )}
            Install & Load
          </Button>
        )}
        {status === "installed" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            disabled={actionInProgress !== null}
            onClick={() => onLoad(ext.extensionName)}
          >
            {isActing ? (
              <IconLoader2 className="h-3 w-3 animate-spin" />
            ) : (
              <IconPlayerPlay className="h-3 w-3" />
            )}
            Load
          </Button>
        )}
      </td>
    </tr>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
    </div>
  );
}

export function DuckDbExtensionsPanel({
  open,
  onClose,
  connectionId,
}: DuckDbExtensionsPanelProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const {
    data: extensions = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["duckdb-extensions", connectionId],
    queryFn: () => BackendAPI.duckdbListExtensions(connectionId),
    enabled: open,
  });

  const installMutation = useMutation({
    mutationFn: (name: string) =>
      BackendAPI.duckdbInstallExtension(connectionId, name),
    onMutate: (name) => setActionInProgress(name),
    onSuccess: (_data, name) => {
      toast.success(`Extension "${name}" installed and loaded`);
      void queryClient.invalidateQueries({
        queryKey: ["duckdb-extensions", connectionId],
      });
    },
    onError: (err, name) => {
      toast.error(`Failed to install "${name}"`, {
        description: String(err),
      });
    },
    onSettled: () => setActionInProgress(null),
  });

  const loadMutation = useMutation({
    mutationFn: (name: string) =>
      BackendAPI.duckdbLoadExtension(connectionId, name),
    onMutate: (name) => setActionInProgress(name),
    onSuccess: (_data, name) => {
      toast.success(`Extension "${name}" loaded`);
      void queryClient.invalidateQueries({
        queryKey: ["duckdb-extensions", connectionId],
      });
    },
    onError: (err, name) => {
      toast.error(`Failed to load "${name}"`, {
        description: String(err),
      });
    },
    onSettled: () => setActionInProgress(null),
  });

  const sorted = sortExtensions(extensions);
  const filtered =
    search.trim().length > 0
      ? sorted.filter(
          (ext) =>
            ext.extensionName.toLowerCase().includes(search.toLowerCase()) ||
            (ext.description?.toLowerCase().includes(search.toLowerCase()) ??
              false),
        )
      : sorted;

  const loadedCount = extensions.filter((e) => e.loaded).length;
  const installedCount = extensions.filter(
    (e) => e.installed && !e.loaded,
  ).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconPuzzle className="h-4 w-4" />
            Extensions
          </DialogTitle>
          <DialogDescription>
            Manage DuckDB extensions.{" "}
            {!isLoading && !error && (
              <span className="text-muted-foreground">
                {loadedCount} loaded, {installedCount} installed,{" "}
                {extensions.length} total
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search extensions..."
              className="pl-8 h-8 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => void refetch()}
            disabled={isLoading}
          >
            <IconRefresh className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {isLoading && <LoadingSkeleton />}

          {error && (
            <div className="py-8 text-center text-sm text-destructive">
              Failed to load extensions: {String(error)}
            </div>
          )}

          {!isLoading && !error && extensions.length === 0 && (
            <div className="py-10 text-center space-y-2">
              <IconPuzzle className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No extensions found.
              </p>
            </div>
          )}

          {!isLoading && !error && filtered.length > 0 && (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium">
                      Extension
                    </th>
                    <th className="text-left px-3 py-2 font-medium w-24">
                      Status
                    </th>
                    <th className="text-right px-3 py-2 font-medium w-32" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ext) => (
                    <ExtensionRow
                      key={ext.extensionName}
                      ext={ext}
                      onInstall={(name) => installMutation.mutate(name)}
                      onLoad={(name) => loadMutation.mutate(name)}
                      actionInProgress={actionInProgress}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading &&
            !error &&
            extensions.length > 0 &&
            filtered.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No extensions match &ldquo;{search}&rdquo;.
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
  );
}
