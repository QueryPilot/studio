import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/appStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  IconRefresh,
  IconLoader2,
  IconCheck,
  IconX,
  IconDownload,
} from "@tabler/icons-react";
import { getVersion } from "@tauri-apps/api/app";

interface ReleaseInfo {
  version: string;
  notes: string;
  pub_date: string;
  download_url: string;
  signature: string | null;
}

export default function GeneralPanel() {
  const {
    theme,
    setTheme,
    sidebarCollapsed,
    toggleSidebar,
    preferences,
    updatePreferences,
  } = useAppStore();
  const { setUnsavedChanges } = usePreferencesStore();

  const [updateStatus, setUpdateStatus] = useState<
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "uptodate"
    | "error"
  >("idle");
  const [updateMessage, setUpdateMessage] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [pendingUpdate, setPendingUpdate] = useState<ReleaseInfo | null>(null);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);

  useEffect(() => {
    setUnsavedChanges(false);
    void getVersion().then(setAppVersion);
  }, []);

  const handleCheckUpdate = async () => {
    try {
      setUpdateStatus("checking");
      setUpdateMessage("");
      setPendingUpdate(null);
      setDownloadedPath(null);

      const update = await invoke<ReleaseInfo | null>("check_for_updates");

      if (update) {
        setUpdateStatus("available");
        setUpdateMessage(`Version ${update.version} available`);
        setPendingUpdate(update);
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

  const handleDownloadUpdate = async () => {
    if (!pendingUpdate) return;

    try {
      setUpdateStatus("downloading");
      setUpdateMessage(`Downloading v${pendingUpdate.version}...`);

      const filePath = await invoke<string>("download_update", {
        url: pendingUpdate.download_url,
      });

      setDownloadedPath(filePath);
      setUpdateStatus("ready");
      setUpdateMessage(
        `v${pendingUpdate.version} downloaded. Ready to install.`,
      );
    } catch (error) {
      setUpdateStatus("error");
      setUpdateMessage(
        error instanceof Error ? error.message : "Failed to download update",
      );
    }
  };

  const handleInstallUpdate = async () => {
    if (!downloadedPath) return;

    try {
      setUpdateMessage("Opening installer...");
      await invoke("install_update", { filePath: downloadedPath });
      setUpdateMessage(
        "Installer opened. Please follow the installation prompts.",
      );
    } catch (error) {
      setUpdateStatus("error");
      setUpdateMessage(
        error instanceof Error ? error.message : "Failed to install update",
      );
    }
  };

  const handleThemeChange = (value: string) => {
    setTheme(value as "light" | "dark" | "system");
    setUnsavedChanges(true);
  };

  const handleFontSizeChange = (value: number[]) => {
    updatePreferences({ fontSize: value[0] });
    setUnsavedChanges(true);
  };

  const handleSidebarToggle = (checked: boolean) => {
    if (checked !== sidebarCollapsed) {
      toggleSidebar();
      setUnsavedChanges(true);
    }
  };

  return (
    <div className="max-w-3xl space-y-6 max-h-[calc(100vh - 32px)] overflow-y-scroll -mx-4 px-4">
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
            <Label className="text-base">Font Size</Label>
            <span className="text-sm font-medium tabular-nums">
              {preferences.fontSize}px
            </span>
          </div>
          <Slider
            value={[preferences.fontSize]}
            onValueChange={handleFontSizeChange}
            min={12}
            max={20}
            step={1}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>12px</span>
            <span>16px</span>
            <span>20px</span>
          </div>
        </div>

        <div className="flex items-center justify-between py-3 border rounded-xl px-4">
          <div className="space-y-0.5">
            <Label className="text-base">Sidebar Collapsed</Label>
            <p className="text-sm text-muted-foreground">
              Keep the sidebar collapsed by default
            </p>
          </div>
          <Switch
            checked={sidebarCollapsed}
            onCheckedChange={handleSidebarToggle}
          />
        </div>

        <div className="space-y-3 pt-4 border-t">
          <Label className="text-base">Updates</Label>
          <div className="flex items-center justify-between py-3 border rounded-xl px-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">
                Current Version: {appVersion || "..."}
              </Label>
              {updateMessage && (
                <p
                  className={`text-sm ${
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
                  onClick={handleDownloadUpdate}
                >
                  <IconDownload className="h-4 w-4 mr-2" />
                  Download
                </Button>
              )}
              {updateStatus === "ready" && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleInstallUpdate}
                >
                  <IconCheck className="h-4 w-4 mr-2" />
                  Install
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleCheckUpdate}
                disabled={
                  updateStatus === "checking" || updateStatus === "downloading"
                }
              >
                {updateStatus === "checking" ||
                updateStatus === "downloading" ? (
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
                  : updateStatus === "downloading"
                  ? "Downloading..."
                  : "Check for Updates"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
