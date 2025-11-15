import { Button } from "@/components/ui/button";
import { SlidersVertical } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferencesStore";

export function AIAssistantSidebar() {
  const { openPreferences } = usePreferencesStore();

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">AI Assistant</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            openPreferences("ai");
          }}
          title="AI Settings"
        >
          <SlidersVertical className="h-4 w-4" />
        </Button>
      </div>

      {/* Placeholder Message */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground space-y-2 max-w-xs">
          <p className="text-sm">AI chat features are under development.</p>
          <p className="text-xs">
            Configure API keys in{" "}
            <button
              onClick={() => {
                openPreferences("ai");
              }}
              className="underline hover:text-foreground"
            >
              Settings
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
