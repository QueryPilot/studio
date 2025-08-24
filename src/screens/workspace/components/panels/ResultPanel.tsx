import type { TabState } from "@/types/workspaceScreen";
import { Table, Clock, Activity } from "lucide-react";

interface ResultPanelProps {
  tab: TabState;
  connectionId: string;
  isActive: boolean;
  onUpdate: (updates: Partial<TabState>) => void;
  onClose: () => void;
}

export function ResultPanel({ 
  tab, 
  connectionId: _connectionId, 
  isActive: _isActive, 
  onUpdate: _onUpdate, 
  onClose: _onClose 
}: ResultPanelProps) {
  const resultId = tab.payload?.resultId;
  // const parentQueryId = tab.payload?.parentQueryId;

  return (
    <div className="h-full flex flex-col">
      {/* Result Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <h3 className="font-medium flex items-center gap-2">
            <Table className="h-4 w-4" />
            Query Result {resultId ? `#${resultId.slice(0, 8)}` : ""}
          </h3>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              <span>1,234 rows</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>125ms</span>
            </div>
          </div>
        </div>
      </div>

      {/* Result Grid */}
      <div className="flex-1 overflow-auto p-4">
        <div className="text-center text-muted-foreground py-8">
          <p className="text-lg font-medium mb-2">Query Results</p>
          <p className="text-sm">Results grid will be displayed here</p>
          <p className="text-xs mt-4">This is a standalone result viewer</p>
        </div>
      </div>
    </div>
  );
}