import { useEffect } from "react";
import { ActionBar } from "./components/ActionBar/ActionBar";
import { MainContent } from "./components/MainContent/MainContent";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { PreferencesDialog } from "@/components/Preferences/PreferencesDialog";
import { useMenuEventListener } from "@/hooks/useMenuEventListener";
import { useHomeScreenStore } from "./store/homeScreenStore";
import { isTauri } from "@/utils/tauri";
import { platform } from "@tauri-apps/plugin-os";
import { WindowControls } from "@/components/WindowControls";

export function HomeScreen() {
  const isMac = isTauri() && platform() === "macos";
  const isWin = isTauri() && platform() === "windows";
  const fetchConnections = useConnectionStore((s) => s.fetchConnections);
  const { openConnectionForm } = useHomeScreenStore();

  useMenuEventListener();

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  // Listen for events from other windows to open connection form
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<{ mode: "create" | "edit" }>(
        "open-connection-form",
        (event) => {
          openConnectionForm(event.payload.mode);
        },
      );
    };

    void setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [openConnectionForm]);

  return (
    <div className="relative h-screen flex flex-col vibrancy-surface">
      {/* Drag region - top bar */}
      <div
        data-tauri-drag-region
        className="h-8 w-full absolute top-0 left-0 right-0 z-50 flex items-center"
      >
        {/* App logo — Windows custom titlebar */}
        {/* {isWin && (
          <div className="flex items-center gap-2 pl-3 pointer-events-none" data-tauri-drag-region>
            <img src="/logo.png" alt="" className="size-4 rounded-sm" draggable={false} />
            <span className="text-xs font-medium text-foreground/70 select-none">Query Pilot</span>
          </div>
        )} */}
        <div className="flex-1" data-tauri-drag-region />
        <WindowControls />
      </div>

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* Left Sidebar - Navigation Hub */}
        <div className={`w-[280px] ${isMac ? "pt-6" : isWin ? "pt-8" : "pt-2"} shrink-0`}>
          <ActionBar />
        </div>

        {/* Right Main Content */}
        <div
          className={`flex-1 overflow-hidden bg-background rounded-xl m-1.5 z-10 ${isWin ? "mt-8" : ""}`}
          data-tauri-drag-region
        >
          <MainContent />
        </div>
      </div>

      <PreferencesDialog />
    </div>
  );
}
