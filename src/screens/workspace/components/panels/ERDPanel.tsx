import type { TabState } from "@/types/workspaceScreen";
import { GitBranch, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ERDPanelProps {
  tab: TabState;
  connectionId: string;
  isActive: boolean;
  onUpdate: (updates: Partial<TabState>) => void;
  onClose: () => void;
}

export function ERDPanel({ 
  tab: _tab, 
  connectionId: _connectionId, 
  isActive: _isActive, 
  onUpdate: _onUpdate, 
  onClose: _onClose 
}: ERDPanelProps) {
  return (
    <div className="h-full flex flex-col">
      {/* ERD Toolbar */}
      <div className="p-2 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          <span className="font-medium text-sm">Entity Relationship Diagram</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ERD Canvas */}
      <div className="flex-1 overflow-hidden bg-grid-pattern">
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">Entity Relationship Diagram</p>
            <p className="text-sm">Visual database schema representation</p>
            <p className="text-xs mt-4">ERD visualization will be implemented here</p>
          </div>
        </div>
      </div>
    </div>
  );
}