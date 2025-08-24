import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { TabState } from "@/types/workspaceScreen";

interface TableViewPanelProps {
  tab: TabState;
  connectionId: string;
  isActive: boolean;
  onUpdate: (updates: Partial<TabState>) => void;
  onClose: () => void;
}

export function TableViewPanel({ 
  tab, 
  connectionId: _connectionId, 
  isActive: _isActive, 
  onUpdate: _onUpdate, 
  onClose: _onClose 
}: TableViewPanelProps) {
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);
  
  // TODO: Get actual table data
  const tableName = tab.payload?.tableName || "Unknown Table";
  const schema = tab.payload?.schema || "public";

  return (
    <div className="flex flex-col h-full">
      {/* Main Table Data Grid */}
      <div className={isPreviewCollapsed ? "flex-1" : "flex-1 min-h-0"}>
        <div className="h-full p-4 overflow-auto">
          <div className="text-center text-muted-foreground py-8">
            <p className="text-lg font-medium mb-2">Table: {schema}.{tableName}</p>
            <p className="text-sm">Table data viewer will be implemented here</p>
            <p className="text-xs mt-4">This will use the DataViewer component</p>
          </div>
        </div>
      </div>

      {/* Collapsible Data Preview Pane */}
      <div className={`border-t ${isPreviewCollapsed ? "h-10" : "h-64"} transition-all`}>
        <div className="flex items-center justify-between px-4 h-10 bg-muted/20">
          <span className="text-sm font-medium">Data Preview</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsPreviewCollapsed(!isPreviewCollapsed)}
          >
            {isPreviewCollapsed ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
        
        {!isPreviewCollapsed && (
          <div className="p-4 h-[calc(100%-2.5rem)] overflow-auto">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Quick data preview and statistics
              </p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Total Rows:</span>
                  <span className="ml-2 font-medium">1,234</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Columns:</span>
                  <span className="ml-2 font-medium">12</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Size:</span>
                  <span className="ml-2 font-medium">45.2 MB</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Last Updated:</span>
                  <span className="ml-2 font-medium">2 hours ago</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}