import { logger } from "@/lib/logger";
import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
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

interface UpdateCheckerProps {
  checkOnMount?: boolean;
}

interface ReleaseInfo {
  version: string;
  notes: string;
  pub_date: string;
  download_url: string;
  signature?: string;
}

interface UpdateState {
  available: boolean;
  version?: string;
  notes?: string;
  downloadUrl?: string;
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

  const checkForUpdates = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: undefined }));

      const releaseInfo = await invoke<ReleaseInfo | null>("check_for_updates");

      if (releaseInfo) {
        setState({
          available: true,
          version: releaseInfo.version,
          notes: releaseInfo.notes,
          downloadUrl: releaseInfo.download_url,
          downloading: false,
          progress: 0,
        });
        setShowDialog(true);
      }
    } catch (error) {
      logger.error("Update check failed:", error);
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  useEffect(() => {
    if (checkOnMount) {
      // Delay check to not block app startup
      const timer = setTimeout(checkForUpdates, 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [checkOnMount, checkForUpdates]);

  const handleInstall = async () => {
    if (!state.downloadUrl) return;

    setState((prev) => ({ ...prev, downloading: true, progress: 0 }));

    try {
      // Download update via Rust backend (authenticated)
      const filePath = await invoke<string>("download_update", {
        url: state.downloadUrl,
      });

      setState((prev) => ({ ...prev, progress: 100 }));

      // Open the downloaded installer
      await invoke("install_update", { filePath });

      // Close dialog - user will install manually
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
              {state.progress < 100 ? "Downloading..." : "Opening installer..."}
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
            {state.downloading ? "Downloading..." : "Download & Install"}
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
      const releaseInfo = await invoke<ReleaseInfo | null>("check_for_updates");

      if (releaseInfo) {
        return {
          available: true,
          version: releaseInfo.version,
          notes: releaseInfo.notes,
        };
      }
      return { available: false };
    } finally {
      setIsChecking(false);
    }
  }, []);

  return { checkForUpdates, isChecking };
}
