import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { PreferencesSidebar } from "./PreferencesSidebar";
import GeneralPanel from "./panels/GeneralPanel";
import EditorPanel from "./panels/EditorPanel";
import AIPanel from "./panels/AIPanel";
import TelemetryPanel from "./panels/TelemetryPanel";
import { GlobalShortcutsPanel } from "./panels/GlobalShortcutsPanel";
import { Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";

// Lazy load the shortcuts panel (it might be heavy)
const ShortcutsPanel = lazy(() => import("./panels/EditorPanel"));

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
      case "editor":
        return <EditorPanel />;
      case "ai":
        return <AIPanel />;
      case "shortcuts":
        return (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <ShortcutsPanel />
          </Suspense>
        );
      case "globalShortcuts":
        return <GlobalShortcutsPanel />;
      case "telemetry":
        return <TelemetryPanel />;
      default:
        return <GeneralPanel />;
    }
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="!max-w-5xl h-[80vh] p-0 gap-0 overflow-hidden"
        showCloseButton={false}
      >
        <div className="flex h-full">
          <PreferencesSidebar />
          <div className="flex-1 overflow-y-auto p-4">{renderPanel()}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
