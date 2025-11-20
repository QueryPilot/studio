import { useEffect, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { AlertCircle, Download, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export interface UpdateCheckerProps {
  /**
   * Check for updates on mount
   * @default true
   */
  checkOnMount?: boolean;

  /**
   * Show a notification when no updates are available
   * @default false
   */
  showNoUpdateNotification?: boolean;
}

/**
 * UpdateChecker component that checks for app updates using Tauri updater plugin
 *
 * Features:
 * - Automatic update check on mount (configurable)
 * - Manual update check button
 * - Download progress indicator
 * - Install and relaunch prompt
 * - Error handling
 *
 * Usage:
 * ```tsx
 * <UpdateChecker checkOnMount={true} />
 * ```
 */
export function UpdateChecker({
  checkOnMount = true,
  showNoUpdateNotification = false,
}: UpdateCheckerProps) {
  const [isChecking, setIsChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string>('');
  const [updateNotes, setUpdateNotes] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isReadyToInstall, setIsReadyToInstall] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [showNoUpdateDialog, setShowNoUpdateDialog] = useState(false);

  const checkForUpdates = async () => {
    setIsChecking(true);
    setError(null);

    try {
      const update = await check();

      if (update) {
        setUpdateAvailable(true);
        setUpdateVersion(update.version);
        setUpdateNotes(
          update.body || 'No release notes available for this version.'
        );
        setShowDialog(true);
      } else {
        if (showNoUpdateNotification) {
          setShowNoUpdateDialog(true);
        }
      }
    } catch (err) {
      console.error('Failed to check for updates:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to check for updates. Please try again later.'
      );
    } finally {
      setIsChecking(false);
    }
  };

  const downloadAndInstall = async () => {
    setIsDownloading(true);
    setError(null);

    try {
      const update = await check();

      if (!update) {
        setError('Update is no longer available.');
        return;
      }

      // Download the update with progress tracking
      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            console.log(`Update download started. Size: ${contentLength} bytes`);
            break;

          case 'Progress':
            downloaded += event.data.chunkLength;
            const progress = contentLength
              ? Math.round((downloaded / contentLength) * 100)
              : 0;
            setDownloadProgress(progress);
            break;

          case 'Finished':
            console.log('Update download finished');
            setIsReadyToInstall(true);
            break;
        }
      });
    } catch (err) {
      console.error('Failed to download update:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to download update. Please try again later.'
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const installAndRelaunch = async () => {
    try {
      await relaunch();
    } catch (err) {
      console.error('Failed to relaunch:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to restart the application. Please restart manually.'
      );
    }
  };

  // Check for updates on mount
  useEffect(() => {
    if (checkOnMount) {
      checkForUpdates();
    }
  }, [checkOnMount]);

  return (
    <>
      {/* Manual check button (optional - can be placed anywhere in your UI) */}
      <Button
        variant="ghost"
        size="sm"
        onClick={checkForUpdates}
        disabled={isChecking}
        className="gap-2"
      >
        <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
        Check for Updates
      </Button>

      {/* Update Available Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update Available</DialogTitle>
            <DialogDescription>
              Version {updateVersion} is now available. Would you like to download
              and install it?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Release Notes */}
            {updateNotes && (
              <div className="rounded-md bg-muted p-3 text-sm max-h-48 overflow-y-auto">
                <div className="whitespace-pre-wrap">{updateNotes}</div>
              </div>
            )}

            {/* Download Progress */}
            {isDownloading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Downloading...</span>
                  <span className="font-medium">{downloadProgress}%</span>
                </div>
                <Progress value={downloadProgress} />
              </div>
            )}

            {/* Ready to Install */}
            {isReadyToInstall && (
              <Alert>
                <Download className="h-4 w-4" />
                <AlertDescription>
                  Update downloaded successfully. Click "Install & Restart" to apply
                  the update.
                </AlertDescription>
              </Alert>
            )}

            {/* Error Message */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Later
            </Button>
            {!isReadyToInstall ? (
              <Button
                onClick={downloadAndInstall}
                disabled={isDownloading}
                className="gap-2"
              >
                {isDownloading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Download Update
                  </>
                )}
              </Button>
            ) : (
              <Button onClick={installAndRelaunch} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Install & Restart
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* No Update Available Dialog */}
      <Dialog open={showNoUpdateDialog} onOpenChange={setShowNoUpdateDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>You're up to date</DialogTitle>
            <DialogDescription>
              You're running the latest version of Query Pilot.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowNoUpdateDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Hook for programmatic update checks
 *
 * Usage:
 * ```tsx
 * const { checkForUpdates, isChecking } = useUpdateChecker();
 *
 * <button onClick={checkForUpdates} disabled={isChecking}>
 *   Check for Updates
 * </button>
 * ```
 */
export function useUpdateChecker() {
  const [isChecking, setIsChecking] = useState(false);

  const checkForUpdates = async () => {
    setIsChecking(true);

    try {
      const update = await check();
      return update;
    } catch (err) {
      console.error('Failed to check for updates:', err);
      throw err;
    } finally {
      setIsChecking(false);
    }
  };

  return {
    checkForUpdates,
    isChecking,
  };
}
