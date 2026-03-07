import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { PreferencesSidebar } from "./PreferencesSidebar";
import GeneralPanel from "./panels/GeneralPanel";
import TelemetryPanel from "./panels/TelemetryPanel";
import { Suspense, lazy } from "react";
import { IconLoader2 } from "@tabler/icons-react";

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
        className="max-w-4xl! w-[900px]! h-[85vh]! max-h-[680px]! rounded-xl! p-0 gap-0 overflow-hidden border z-50"
        showCloseButton={false}
      >
        <div className="flex h-full">
          <PreferencesSidebar />
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <div className="flex-1 overflow-y-auto px-8 py-6">
              {renderPanel()}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
