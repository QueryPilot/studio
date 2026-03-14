import { useEffect } from "react";
import { ActionBar } from "./components/ActionBar/ActionBar";
import { MainContent } from "./components/MainContent/MainContent";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { PreferencesDialog } from "@/components/Preferences/PreferencesDialog";
import { useMenuEventListener } from "@/hooks/useMenuEventListener";
import { useHomeScreenStore } from "./store/homeScreenStore";
import { isTauri } from "@/utils/tauri";

export function HomeScreen() {
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
    <div className="relative h-screen flex flex-col bg-secondary/80">
      {/* Drag region - top bar */}
      <div
        data-tauri-drag-region
        className="h-8 w-full absolute top-0 left-0 right-0 z-50"
      />

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* Left Sidebar - Navigation Hub */}
        <div className="w-[280px] pt-6 shrink-0">
          <ActionBar />
        </div>

        {/* Right Main Content */}
        <div
          className="flex-1 overflow-hidden bg-background rounded-xl m-1.5 ml-0 z-10"
          data-tauri-drag-region
        >
          <MainContent />
        </div>
      </div>

      <PreferencesDialog />
    </div>
  );
}
