import { useEffect, lazy, Suspense } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { PreferencesSidebar } from "./PreferencesSidebar";
import { Loader2 } from "lucide-react";

const categoryPanels = {
  general: lazy(() => import("./panels/GeneralPanel")),
  editor: lazy(() => import("./panels/EditorPanel")),
  ai: lazy(() => import("./panels/AIPanel")),
  shortcuts: lazy(() => import("./panels/ShortcutsPanel")),
};

export function PreferencesDialog() {
  const { isOpen, close, activeCategory, unsavedChanges } =
    usePreferencesStore();

  const handleClose = () => {
    if (unsavedChanges) {
      const confirmed = confirm(
        "You have unsaved changes. Are you sure you want to close?",
      );
      if (!confirmed) return;
    }
    close();
  };

  const handleSave = () => {
    // Save logic will be implemented in each panel
    close();
  };

  const handleReset = () => {
    const confirmed = confirm(
      "Are you sure you want to reset all settings to defaults?",
    );
    if (!confirmed) return;
    // Reset logic to be implemented
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, unsavedChanges]);

  const PanelComponent = categoryPanels[activeCategory];

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="min-w-[80vw] max-w-[95vw] max-h-[85vh] p-0 overflow-hidden">
        <div className="flex h-[700px]">
          <PreferencesSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto p-6">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <PanelComponent />
              </Suspense>
            </div>
            <div className="flex items-center justify-between px-6 py-4 border-t bg-background">
              <Button variant="outline" onClick={handleReset}>
                Reset to Defaults
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={!unsavedChanges}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
