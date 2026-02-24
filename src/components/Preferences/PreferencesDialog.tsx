import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { PreferencesSidebar } from "./PreferencesSidebar";
import GeneralPanel from "./panels/GeneralPanel";
import TelemetryPanel from "./panels/TelemetryPanel";
import { Suspense, lazy } from "react";
import { IconLoader2, IconChevronLeft } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Lazy load the shortcuts panel (it might be heavy)
const ShortcutsPanel = lazy(() => import("./panels/KeyboardShortcutsPanel"));
const AIPreferencesPanel = lazy(() => import("./panels/AIPreferencesPanel"));

interface PreferencesDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function PreferencesDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: PreferencesDialogProps) {
  const { isOpen, closePreferences, activeCategory } = usePreferencesStore();

  // Use controlled or internal state
  const isDialogOpen = controlledOpen !== undefined ? controlledOpen : isOpen;
  const handleOpenChange =
    controlledOnOpenChange !== undefined
      ? controlledOnOpenChange
      : (open: boolean) => {
          if (!open) closePreferences();
        };

  const renderPanel = () => {
    switch (activeCategory) {
      case "general":
        return <GeneralPanel />;
      case "shortcuts":
        return (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <ShortcutsPanel />
          </Suspense>
        );
      case "ai":
        return (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <AIPreferencesPanel />
          </Suspense>
        );
      case "telemetry":
        return <TelemetryPanel />;
      default:
        return <GeneralPanel />;
    }
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-none! w-screen! h-screen! rounded-none! p-0 gap-0 overflow-hidden border-none z-50 bg-secondary"
        showCloseButton={false}
      >
        <div className="relative z-50 flex h-full" data-tauri-drag-region>
          <div className="flex flex-col" data-tauri-drag-region>
            <div
              data-tauri-drag-region
              className="h-8 flex items-center px-3 w-screen pl-20 absolute top-0 left-0 z-50"
            >
              <Button
                variant="ghost"
                className={cn(
                  "px-2 gap-1 text-muted-foreground hover:text-foreground focus:outline-none outline-none",
                  { "mt-[5px]": ["", "/"].includes(window.location.pathname) },
                )}
                onClick={() => {
                  handleOpenChange(false);
                }}
              >
                <IconChevronLeft className="size-4!" />
                <span className="text-sm">Back</span>
              </Button>
            </div>
            <PreferencesSidebar />
          </div>
          <div className="flex-1 flex flex-col overflow-hidden p-2 pl-0 bg-transparent">
            <div className="flex-1 overflow-y-auto p-6 max-h-screen bg-background rounded-xl">
              {renderPanel()}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
