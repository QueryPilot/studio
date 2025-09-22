import { Sparkles, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatHeaderProps {
  onSettingsClick?: () => void;
}

export function ChatHeader({
  onSettingsClick
}: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between h-8 px-3 border-b">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-blue-500" />
        <h3 className="font-medium text-xs">AI Chat Assistant</h3>
      </div>

      {onSettingsClick && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onSettingsClick}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}