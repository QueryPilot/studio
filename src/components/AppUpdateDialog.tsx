import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Streamdown } from "streamdown";
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
import { useAppStore } from "@/stores/appStore";
import {
  checkForAppUpdates,
  deferPendingAppUpdate,
  downloadPendingAppUpdate,
  installPendingAppUpdateAndRelaunch,
} from "@/utils/appUpdate";
import {
  IconCheck,
  IconClock,
  IconDownload,
  IconLoader2,
  IconRefresh,
  IconRotate,
} from "@tabler/icons-react";

export function AppUpdateDialog() {
  const isOpen = useAppStore((state) => state.isUpdateDialogOpen);
  const closeUpdateDialog = useAppStore((state) => state.closeUpdateDialog);
  const pendingUpdate = useAppStore((state) => state.pendingUpdate);
  const isCheckingForUpdate = useAppStore((state) => state.isCheckingForUpdate);
  const isDownloadingUpdate = useAppStore((state) => state.isDownloadingUpdate);
  const isInstallingUpdate = useAppStore((state) => state.isInstallingUpdate);
  const updateError = useAppStore((state) => state.updateError);
  const [currentVersion, setCurrentVersion] = useState<string>("");

  useEffect(() => {
    void getVersion()
      .then((version) => {
        setCurrentVersion(version);
      })
      .catch(() => {
        setCurrentVersion("");
      });
  }, []);

  const releaseNotes = useMemo(() => {
    const raw = pendingUpdate?.body?.trim();
    if (!raw) {
      return "No changelog was provided for this release.";
    }
    return raw;
  }, [pendingUpdate?.body]);

  const isBusy = isCheckingForUpdate || isDownloadingUpdate || isInstallingUpdate;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeUpdateDialog();
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconRotate className="h-4 w-4" />
            App Update
          </DialogTitle>
          <DialogDescription>
            {pendingUpdate
              ? `A new version is available: v${pendingUpdate.version}`
              : "Check for updates and review release notes before installing."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {currentVersion ? (
              <Badge variant="outline">Current: v{currentVersion}</Badge>
            ) : null}
            {pendingUpdate ? (
              <Badge>Latest: v{pendingUpdate.version}</Badge>
            ) : (
              <Badge variant="secondary">No update detected</Badge>
            )}
            {pendingUpdate?.downloaded ? (
              <Badge variant="secondary" className="gap-1">
                <IconCheck className="h-3 w-3" />
                Downloaded
              </Badge>
            ) : null}
          </div>

          <div className="rounded-md border bg-muted/30">
            <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground border-b">
              Changelog
            </div>
            <div className="max-h-96 overflow-auto p-3 text-xs">
              <Streamdown className="select-text">{releaseNotes}</Streamdown>
            </div>
          </div>

          {pendingUpdate?.downloaded ? (
            <div className="rounded-md border bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              Update package is ready. Restart now to apply it, or choose restart later.
            </div>
          ) : null}

          {updateError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {updateError}
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-wrap">
          {pendingUpdate?.downloaded ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                deferPendingAppUpdate();
              }}
              disabled={isBusy}
            >
              <IconClock className="h-4 w-4 mr-2" />
              Restart Later
            </Button>
          ) : null}

          {pendingUpdate ? (
            pendingUpdate.downloaded ? (
              <Button
                type="button"
                onClick={() => {
                  void installPendingAppUpdateAndRelaunch();
                }}
                disabled={isBusy}
              >
                {isInstallingUpdate ? (
                  <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <IconRefresh className="h-4 w-4 mr-2" />
                )}
                {isInstallingUpdate ? "Installing..." : "Restart & Install"}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => {
                  void downloadPendingAppUpdate();
                }}
                disabled={isBusy}
              >
                {isDownloadingUpdate ? (
                  <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <IconDownload className="h-4 w-4 mr-2" />
                )}
                {isDownloadingUpdate ? "Downloading..." : "Download Update"}
              </Button>
            )
          ) : null}

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void checkForAppUpdates({ manual: true, openDialog: true });
            }}
            disabled={isBusy}
          >
            {isCheckingForUpdate ? (
              <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <IconRotate className="h-4 w-4 mr-2" />
            )}
            {isCheckingForUpdate ? "Checking..." : "Check for Updates"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
