import logo from "@/assets/logo.png";
import { Badge } from "@/components/ui/badge";

export function TitleBar() {
  return (
    <div 
      data-tauri-drag-region
      className="h-10 bg-background/95 backdrop-blur border-b flex items-center justify-center fixed top-0 left-0 right-0 select-none z-50"
    >
      <div className="flex items-center gap-3">
        <img src={logo} alt="DevDB Studio" className="h-5 w-5 rounded" />
        <span className="text-sm font-semibold">DevDB Studio</span>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          v0.1.0
        </Badge>
      </div>
    </div>
  );
}