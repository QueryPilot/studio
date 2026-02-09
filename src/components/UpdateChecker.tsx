/* eslint-disable react-refresh/only-export-components */
import { logger } from "@/lib/logger";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

interface UpdateCheckerProps {
  checkOnMount?: boolean;
}

interface UpdateState {
  available: boolean;
  version?: string;
  notes?: string;
  downloading: boolean;
  progress: number;
  error?: string;
}

export function UpdateChecker({ checkOnMount = false }: UpdateCheckerProps) {
  const [state, setState] = useState<UpdateState>({
    available: false,
    downloading: false,
    progress: 0,
  });
  const [showDialog, setShowDialog] = useState(false);
  const pendingUpdateRef = useRef<Update | null>(null);

  const closePendingUpdate = useCallback(async () => {
    const pending = pendingUpdateRef.current;
    pendingUpdateRef.current = null;
    if (!pending) {
      return;
    }
    try {
      await pending.close();
    } catch (error) {
      logger.warn("Failed to close update handle", error);
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: undefined }));

      await closePendingUpdate();
      const update = await check();

      if (update) {
        pendingUpdateRef.current = update;
        setState({
          available: true,
          version: update.version,
          notes: update.body ?? "",
          downloading: false,
          progress: 0,
        });
        setShowDialog(true);
      } else {
        setState({
          available: false,
          downloading: false,
          progress: 0,
        });
      }
    } catch (error) {
      logger.error("Update check failed:", error);
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [closePendingUpdate]);

  useEffect(() => {
    if (checkOnMount) {
      // Delay check to not block app startup
      const timer = setTimeout(checkForUpdates, 3000);
      return () => { clearTimeout(timer); };
    }
    return undefined;
  }, [checkOnMount, checkForUpdates]);

  useEffect(() => () => {
    void closePendingUpdate();
  }, [closePendingUpdate]);

  const handleInstall = async () => {
    const pendingUpdate = pendingUpdateRef.current;
    if (!pendingUpdate) return;

    setState((prev) => ({ ...prev, downloading: true, progress: 0 }));

    try {
      await pendingUpdate.downloadAndInstall();
      setState((prev) => ({ ...prev, progress: 100 }));
      await closePendingUpdate();
      await relaunch();
      setShowDialog(false);
    } catch (error) {
      logger.error("Update install failed:", error);
      setState((prev) => ({
        ...prev,
        downloading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const handleClose = () => {
    void closePendingUpdate();
    setShowDialog(false);
    setState({
      available: false,
      downloading: false,
      progress: 0,
    });
  };

  return (
    <Dialog open={showDialog} onOpenChange={setShowDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update Available</DialogTitle>
          <DialogDescription>
            Version {state.version} is available for download.
          </DialogDescription>
        </DialogHeader>

        {state.notes && (
          <div className="max-h-48 overflow-y-auto rounded-md bg-muted p-3 text-xs">
            <pre className="whitespace-pre-wrap font-sans">{state.notes}</pre>
          </div>
        )}

        {state.downloading && (
          <div className="space-y-2">
            <Progress value={state.progress} />
            <p className="text-center text-xs text-muted-foreground">
              {state.progress < 100 ? "Installing..." : "Restarting..."}
            </p>
          </div>
        )}

        {state.error && (
          <p className="text-xs text-destructive">{state.error}</p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={state.downloading}
          >
            Later
          </Button>
          <Button onClick={handleInstall} disabled={state.downloading}>
            {state.downloading ? "Installing..." : "Install Update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Hook for manual update checking
export function useUpdateChecker() {
  const [isChecking, setIsChecking] = useState(false);

  const checkForUpdates = useCallback(async () => {
    setIsChecking(true);
    try {
      const update = await check();

      if (update) {
        const result = {
          available: true,
          version: update.version,
          notes: update.body ?? "",
        };
        try {
          await update.close();
        } catch (error) {
          logger.warn("Failed to close update handle", error);
        }
        return {
          ...result,
        };
      }
      return { available: false };
    } finally {
      setIsChecking(false);
    }
  }, []);

  return { checkForUpdates, isChecking };
}
