import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores/appStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconRefresh,
  IconLoader2,
  IconCheck,
  IconX,
  IconDownload,
} from "@tabler/icons-react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export default function GeneralPanel() {
  const { theme, setTheme, zoomLevel, setZoomLevel } = useAppStore();
  const { setUnsavedChanges, queryTimeoutSecs, setQueryTimeoutSecs } =
    usePreferencesStore();

  const [updateStatus, setUpdateStatus] = useState<
    | "idle"
    | "checking"
    | "available"
    | "installing"
    | "uptodate"
    | "error"
  >("idle");
  const [updateMessage, setUpdateMessage] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const pendingUpdateRef = useRef<Update | null>(null);

  const closePendingUpdate = useCallback(async () => {
    const pending = pendingUpdateRef.current;
    pendingUpdateRef.current = null;

    if (!pending) {
      return;
    }

    try {
      await pending.close();
    } catch {
      // Ignore close errors; update handles are best-effort cleanup.
    }
  }, []);

  useEffect(() => {
    setUnsavedChanges(false);
    void getVersion().then(setAppVersion);
  }, [setUnsavedChanges]);

  useEffect(
    () => () => {
      void closePendingUpdate();
    },
    [closePendingUpdate],
  );

  const handleCheckUpdate = async () => {
    try {
      setUpdateStatus("checking");
      setUpdateMessage("");
      setAvailableVersion(null);
      await closePendingUpdate();
      const update = await check();

      if (update) {
        pendingUpdateRef.current = update;
        setAvailableVersion(update.version);
        setUpdateStatus("available");
        setUpdateMessage(`Version ${update.version} available`);
      } else {
        setUpdateStatus("uptodate");
        setUpdateMessage("You're on the latest version");
      }
    } catch (error) {
      setUpdateStatus("error");
      setUpdateMessage(
        error instanceof Error ? error.message : "Failed to check for updates",
      );
    }
  };

  const handleInstallUpdate = async () => {
    const pendingUpdate = pendingUpdateRef.current;
    if (!pendingUpdate) return;

    try {
      setUpdateStatus("installing");
      setUpdateMessage(`Installing v${pendingUpdate.version}...`);
      await pendingUpdate.downloadAndInstall();
      await closePendingUpdate();
      setUpdateMessage("Update installed. Restarting...");
      await relaunch();
    } catch (error) {
      setUpdateStatus("error");
      setUpdateMessage(
        error instanceof Error ? error.message : "Failed to install update.",
      );
    }
  };

  const handleThemeChange = (value: string) => {
    setTheme(value as "light" | "dark" | "system");
    setUnsavedChanges(true);
  };

  const handleZoomChange = (value: number[]) => {
    const level = value[0];
    if (level !== undefined) {
      setZoomLevel(level);
      setUnsavedChanges(true);
    }
  };

  return (
    <div className="max-w-3xl space-y-6 max-h-[calc(100vh-32px)] overflow-y-scroll -mx-4 px-4">
      <div className="sticky top-0 bg-background z-10 pb-2">
        <h2 className="text-base font-semibold">General Settings</h2>
        <p className="text-xs text-muted-foreground">
          Configure the application appearance and behavior
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <Label className="text-base">Theme</Label>
          <RadioGroup
            value={theme}
            onValueChange={handleThemeChange}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="light" id="light" />
              <Label htmlFor="light" className="font-normal cursor-pointer">
                Light
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="dark" id="dark" />
              <Label htmlFor="dark" className="font-normal cursor-pointer">
                Dark
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="system" id="system" />
              <Label htmlFor="system" className="font-normal cursor-pointer">
                System
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base">Zoom Level</Label>
            <span className="text-xs font-medium tabular-nums">
              {zoomLevel}%
            </span>
          </div>
          <Slider
            value={[zoomLevel]}
            onValueChange={handleZoomChange}
            min={75}
            max={150}
            step={5}
            className="w-full"
          />
          <div className="relative h-4 text-[10px] text-muted-foreground">
            {[75, 90, 100, 110, 125, 150].map((stop) => (
              <span
                key={stop}
                className="absolute -translate-x-1/2 tabular-nums"
                style={{ left: `${((stop - 75) / 75) * 100}%` }}
              >
                {stop}%
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-3 pt-4 border-t">
          <Label className="text-base">Query Execution</Label>
          <div className="flex items-center justify-between py-3 border rounded-xl px-4">
            <div className="space-y-0.5">
              <Label className="text-xs font-medium">Query Timeout</Label>
              <p className="text-xs text-muted-foreground">
                Maximum time for queries to run (0 = no timeout)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={3600}
                value={queryTimeoutSecs}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  if (!isNaN(value) && value >= 0) {
                    setQueryTimeoutSecs(value);
                    setUnsavedChanges(true);
                  }
                }}
                className="w-20 h-8 text-xs"
              />
              <span className="text-xs text-muted-foreground">seconds</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground px-1">
            Recommended: 300 seconds (5 minutes). Long-running analytics queries
            may need more time.
          </p>
        </div>

        <div className="space-y-3 pt-4 border-t">
          <Label className="text-base">Updates</Label>
          <div className="flex items-center justify-between py-3 border rounded-xl px-4">
            <div className="space-y-0.5">
              <Label className="text-xs font-medium">
                Current Version: {appVersion || "..."}
              </Label>
              {updateMessage && (
                <p
                  className={`text-xs ${
                    updateStatus === "error"
                      ? "text-destructive"
                      : updateStatus === "uptodate"
                        ? "text-green-600"
                        : "text-muted-foreground"
                  }`}
                >
                  {updateMessage}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {updateStatus === "available" && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleInstallUpdate}
                >
                  <IconDownload className="h-4 w-4 mr-2" />
                  Install{" "}
                  {availableVersion ? `v${availableVersion}` : "Update"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleCheckUpdate}
                disabled={
                  updateStatus === "checking" || updateStatus === "installing"
                }
              >
                {updateStatus === "checking" ||
                updateStatus === "installing" ? (
                  <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : updateStatus === "uptodate" ? (
                  <IconCheck className="h-4 w-4 mr-2 text-green-600" />
                ) : updateStatus === "error" ? (
                  <IconX className="h-4 w-4 mr-2 text-destructive" />
                ) : (
                  <IconRefresh className="h-4 w-4 mr-2" />
                )}
                {updateStatus === "checking"
                  ? "Checking..."
                  : updateStatus === "installing"
                    ? "Installing..."
                    : "Check for Updates"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
