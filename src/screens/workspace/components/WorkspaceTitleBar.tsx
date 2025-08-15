import { Button } from "@/components/ui/button";
import { Home, PanelLeft, PanelRight, Settings, Moon, Sun } from "lucide-react";
import { windowManager } from "@/services/windowManager";
import { useTheme } from "@/components/theme-provider";

interface WorkspaceTitleBarProps {
  queryProgress?: number;
  onToggleLeftPanel?: () => void;
  onToggleRightPanel?: () => void;
  leftPanelVisible?: boolean;
  rightPanelVisible?: boolean;
}

export function WorkspaceTitleBar({
  queryProgress,
  onToggleLeftPanel,
  onToggleRightPanel,
  leftPanelVisible = true,
  rightPanelVisible = true,
}: WorkspaceTitleBarProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      data-tauri-drag-region
      className="h-7 border-b bg-background/95 backdrop-blur flex items-center justify-between pl-4 pr-2"
    >
      <div className="flex items-center gap-2 ml-20">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 !p-0"
          onClick={async () => {
            await windowManager.openMain();
          }}
          title="Back to Home"
        >
          <Home className="h-7 w-7" />
        </Button>
      </div>

      <div className="flex items-center gap-3">
        {queryProgress !== undefined && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Query:</span>
            <div className="w-28 h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${queryProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Center panel toggle buttons */}
      <div className="flex items-center justify-end gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 !p-0 rounded-sm"
          onClick={onToggleLeftPanel}
          title="Toggle Sidebar"
        >
          <PanelLeft
            className={`h-7 w-7 ${
              leftPanelVisible ? "text-primary" : "text-muted-foreground"
            }`}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 !p-0 rounded-sm"
          onClick={onToggleRightPanel}
          title="Toggle Right Panel"
        >
          <PanelRight
            className={`h-7 w-7 ${
              rightPanelVisible ? "text-primary" : "text-muted-foreground"
            }`}
          />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 !p-0 rounded-sm"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle theme"
        >
          {theme === "dark" ? (
            <Sun className="h-7 w-7 text-muted-foreground" />
          ) : (
            <Moon className="h-7 w-7 text-muted-foreground" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 !p-0 rounded-sm"
          title="Settings"
        >
          <Settings className="h-7 w-7 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}
