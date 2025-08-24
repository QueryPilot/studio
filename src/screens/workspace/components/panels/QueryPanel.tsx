import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, ChevronUp, ChevronDown } from "lucide-react";
import type { TabState } from "@/types/workspaceScreen";

interface QueryPanelProps {
  tab: TabState;
  connectionId: string;
  isActive: boolean;
  onUpdate: (updates: Partial<TabState>) => void;
  onClose: () => void;
}

export function QueryPanel({ 
  tab, 
  connectionId: _connectionId, 
  isActive: _isActive, 
  onUpdate, 
  onClose: _onClose 
}: QueryPanelProps) {
  const [isResultsCollapsed, setIsResultsCollapsed] = useState(false);
  const [query, setQuery] = useState(tab.payload?.sql || "");

  const handleExecute = () => {
    // TODO: Execute query
    console.log("Execute query:", query);
  };

  return (
    <div className="flex flex-col h-full">
      {/* SQL Editor Area */}
      <div className={isResultsCollapsed ? "flex-1" : "flex-1 min-h-0"}>
        <div className="flex flex-col h-full">
          {/* Toolbar */}
          <div className="flex items-center justify-between p-2 border-b">
            <Button
              size="sm"
              onClick={handleExecute}
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              Execute
            </Button>
          </div>
          
          {/* Editor */}
          <div className="flex-1 p-4">
            <textarea
              className="w-full h-full p-3 font-mono text-sm bg-muted/20 rounded resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Enter your SQL query here..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                onUpdate({ payload: { ...tab.payload, sql: e.target.value } });
              }}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Monaco Editor will be integrated here
            </p>
          </div>
        </div>
      </div>

      {/* Collapsible Query Results Pane */}
      <div className={`border-t ${isResultsCollapsed ? "h-10" : "h-80"} transition-all`}>
        <div className="flex items-center justify-between px-4 h-10 bg-muted/20">
          <span className="text-sm font-medium">Query Results</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsResultsCollapsed(!isResultsCollapsed)}
          >
            {isResultsCollapsed ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
        
        {!isResultsCollapsed && (
          <div className="p-4 h-[calc(100%-2.5rem)] overflow-auto">
            <div className="text-center text-muted-foreground py-8">
              <p className="text-sm">Execute a query to see results</p>
              <p className="text-xs mt-2">Results will be displayed here</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}