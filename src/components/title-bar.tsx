import { Button } from "@/components/ui/button";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import logo from "@/assets/logo.png";

export function TitleBar() {
  const appWindow = getCurrentWindow();
  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  return (
    <div 
      data-tauri-drag-region
      className="flex h-8 select-none items-center justify-between bg-background border-b"
    >
      {/* Left side - Logo and title */}
      <div className="flex items-center gap-2 px-3">
        <img src={logo} alt="DevDB Studio" className="h-4 w-4" />
        <span className="text-xs font-medium">DevDB Studio</span>
      </div>

      {/* Right side - Window controls */}
      <div className="flex">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-12 rounded-none hover:bg-secondary"
          onClick={handleMinimize}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-12 rounded-none hover:bg-secondary"
          onClick={handleMaximize}
        >
          <Square className="h-2.5 w-2.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-12 rounded-none hover:bg-destructive hover:text-destructive-foreground"
          onClick={handleClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}