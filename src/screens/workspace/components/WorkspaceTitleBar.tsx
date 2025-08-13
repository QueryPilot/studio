import { Button } from "@/components/ui/button";
import {
  Home,
  PanelLeft,
  PanelRight,
  PanelBottom,
  Settings,
  Moon,
  Sun,
} from "lucide-react";
import { windowManager } from "@/services/windowManager";
import { useParams } from "react-router-dom";
import { useTheme } from "@/components/theme-provider";

interface WorkspaceTitleBarProps {
  queryProgress?: number;
  onToggleLeftPanel?: () => void;
  onToggleRightPanel?: () => void;
  onToggleBottomPanel?: () => void;
  leftPanelVisible?: boolean;
  rightPanelVisible?: boolean;
  bottomPanelVisible?: boolean;
}

export function WorkspaceTitleBar({
  queryProgress,
  onToggleLeftPanel,
  onToggleRightPanel,
  onToggleBottomPanel,
  leftPanelVisible = true,
  rightPanelVisible = true,
  bottomPanelVisible = true,
}: WorkspaceTitleBarProps) {
  const { id } = useParams<{ id: string }>();
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
          className="h-6 w-6 p-0"
          onClick={async () => {
            await windowManager.closeWorkspace(id || "");
            await windowManager.openMain();
          }}
          title="Back to Home"
        >
          <Home className="h-3 w-3" />
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
          className="h-6 w-6 p-0 rounded-sm !bg-transparent"
          onClick={onToggleLeftPanel}
          title="Toggle Sidebar"
        >
          <PanelLeft
            className={`h-3 w-3 ${
              leftPanelVisible ? "text-primary" : "text-muted-foreground"
            }`}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 rounded-sm !bg-transparent"
          onClick={onToggleBottomPanel}
          title="Toggle Result Panel"
        >
          <PanelBottom
            className={`h-3 w-3 ${
              bottomPanelVisible ? "text-primary" : "text-muted-foreground"
            }`}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 rounded-sm !bg-transparent"
          onClick={onToggleRightPanel}
          title="Toggle Right Panel"
        >
          <PanelRight
            className={`h-3 w-3 ${
              rightPanelVisible ? "text-primary" : "text-muted-foreground"
            }`}
          />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 rounded-sm !bg-transparent"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle theme"
        >
          {theme === "dark" ? (
            <Sun className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Moon className="h-3 w-3 text-muted-foreground" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 rounded-sm !bg-transparent"
          title="Settings"
        >
          <Settings className="h-3 w-3 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}
