import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/stores/appStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useEffect, useMemo, useState } from "react";
import {
  IconRefresh,
  IconLoader2,
  IconCheck,
  IconX,
  IconRotate,
} from "@tabler/icons-react";
import { getVersion } from "@tauri-apps/api/app";
import { checkForAppUpdates, openAppUpdateDialog } from "@/utils/appUpdate";

export default function GeneralPanel() {
  const { theme, setTheme, zoomLevel, setZoomLevel } = useAppStore();
  const pendingUpdate = useAppStore((state) => state.pendingUpdate);
  const isCheckingForUpdate = useAppStore((state) => state.isCheckingForUpdate);
  const isDownloadingUpdate = useAppStore((state) => state.isDownloadingUpdate);
  const isInstallingUpdate = useAppStore((state) => state.isInstallingUpdate);
  const updateError = useAppStore((state) => state.updateError);
  const {
    autoCheckForUpdates,
    queryTimeoutSecs,
    setAutoCheckForUpdates,
    setQueryTimeoutSecs,
    setUnsavedChanges,
  } = usePreferencesStore();
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    setUnsavedChanges(false);
    void getVersion().then(setAppVersion);
  }, [setUnsavedChanges]);

  const updateMessage = useMemo(() => {
    if (updateError) {
      return updateError;
    }
    if (pendingUpdate?.downloaded) {
      return `v${pendingUpdate.version} is ready to install on restart`;
    }
    if (pendingUpdate) {
      return `Version ${pendingUpdate.version} available`;
    }
    return "";
  }, [pendingUpdate, updateError]);

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
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="shrink-0 px-8 pt-6 pb-3 sticky top-0 bg-background z-10">
        <h2 className="text-base font-semibold">General Settings</h2>
        <p className="text-xs text-muted-foreground">
          Configure the application appearance and behavior
        </p>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8 pt-6 space-y-6">
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
                Auto-check updates on startup
              </Label>
              <p className="text-xs text-muted-foreground">
                Turn off to disable automatic update checks.
              </p>
            </div>
            <Switch
              checked={autoCheckForUpdates}
              onCheckedChange={(checked) => {
                setAutoCheckForUpdates(checked);
                setUnsavedChanges(true);
              }}
            />
          </div>

          <div className="flex items-center justify-between py-3 border rounded-xl px-4">
            <div className="space-y-0.5">
              <Label className="text-xs font-medium">
                Current Version: {appVersion || "..."}
              </Label>
              {updateMessage ? (
                <p
                  className={`text-xs ${
                    updateError
                      ? "text-destructive"
                      : pendingUpdate?.downloaded
                        ? "text-primary"
                        : "text-muted-foreground"
                  }`}
                >
                  {updateMessage}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Check for updates manually anytime.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {pendingUpdate ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    openAppUpdateDialog();
                  }}
                  disabled={
                    isCheckingForUpdate ||
                    isDownloadingUpdate ||
                    isInstallingUpdate
                  }
                >
                  <IconRotate className="h-4 w-4 mr-2" />
                  {pendingUpdate.downloaded
                    ? "Restart to Apply"
                    : "View Update"}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void checkForAppUpdates({ manual: true, openDialog: true });
                }}
                disabled={
                  isCheckingForUpdate ||
                  isDownloadingUpdate ||
                  isInstallingUpdate
                }
              >
                {isCheckingForUpdate ||
                isDownloadingUpdate ||
                isInstallingUpdate ? (
                  <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : updateError ? (
                  <IconX className="h-4 w-4 mr-2 text-destructive" />
                ) : pendingUpdate?.downloaded ? (
                  <IconCheck className="h-4 w-4 mr-2 text-green-600" />
                ) : (
                  <IconRefresh className="h-4 w-4 mr-2" />
                )}
                {isCheckingForUpdate
                  ? "Checking..."
                  : isDownloadingUpdate
                    ? "Downloading..."
                    : isInstallingUpdate
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
