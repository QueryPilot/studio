import { useEffect } from "react";
import { ActionBar } from "./components/ActionBar/ActionBar";
import { MainContent } from "./components/MainContent/MainContent";
import { useConnectionStore } from "@/stores/connectionStoreNew";

export function HomeScreen() {
  const fetchConnections = useConnectionStore((s) => s.fetchConnections);

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  return (
    <div className="relative h-screen flex flex-col bg-secondary">
      {/* Drag region - top bar */}
      <div
        data-tauri-drag-region
        className="h-8 w-full flex-shrink-0 absolute top-0 left-0 right-0 z-50"
      />

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* Left Action Bar - fixed width */}
        <div className="flex-shrink-0 w-64 pt-6">
          <ActionBar />
        </div>

        {/* Right Main Content */}
        <div
          className="flex-1 overflow-hidden bg-background rounded-xl m-1.5 z-10"
          data-tauri-drag-region
        >
          <MainContent />
        </div>
      </div>
    </div>
  );
}
