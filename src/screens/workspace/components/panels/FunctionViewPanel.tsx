import type { TabState } from "@/types/workspaceScreen";
import { FunctionSquare, Code, FileText, Clock } from "lucide-react";

interface FunctionViewPanelProps {
  tab: TabState;
  connectionId: string;
  isActive: boolean;
  onUpdate: (updates: Partial<TabState>) => void;
  onClose: () => void;
}

export function FunctionViewPanel({ 
  tab, 
  connectionId: _connectionId, 
  isActive: _isActive, 
  onUpdate: _onUpdate, 
  onClose: _onClose 
}: FunctionViewPanelProps) {
  const functionName = tab.payload?.objectName || "Unknown Function";
  const schema = tab.payload?.schema || "public";

  return (
    <div className="h-full overflow-auto p-4">
      <div className="space-y-6">
        {/* Function Header */}
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FunctionSquare className="h-5 w-5" />
            {schema}.{functionName}
          </h2>
        </div>

        {/* Function Info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Code className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Return Type:</span>
              <span className="font-medium">INTEGER</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Language:</span>
              <span className="font-medium">plpgsql</span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Created:</span>
              <span className="font-medium">2024-01-15</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Modified:</span>
              <span className="font-medium">2024-01-20</span>
            </div>
          </div>
        </div>

        {/* Function Source */}
        <div className="space-y-2">
          <h3 className="font-medium">Source Code</h3>
          <div className="p-4 bg-muted/20 rounded-lg font-mono text-sm">
            <pre className="whitespace-pre-wrap">
{`CREATE OR REPLACE FUNCTION ${schema}.${functionName}(
  param1 INTEGER,
  param2 VARCHAR
)
RETURNS INTEGER AS $$
BEGIN
  -- Function body will be displayed here
  RETURN param1;
END;
$$ LANGUAGE plpgsql;`}
            </pre>
          </div>
        </div>

        {/* Parameters */}
        <div className="space-y-2">
          <h3 className="font-medium">Parameters</h3>
          <div className="text-sm text-muted-foreground">
            <p>Function parameters and their types will be listed here</p>
          </div>
        </div>
      </div>
    </div>
  );
}