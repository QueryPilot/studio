import type { TabState } from "@/types/workspaceScreen";
import { Database, Table, Columns, Key } from "lucide-react";

interface SchemaViewPanelProps {
  tab: TabState;
  connectionId: string;
  isActive: boolean;
  onUpdate: (updates: Partial<TabState>) => void;
  onClose: () => void;
}

export function SchemaViewPanel({ 
  tab, 
  connectionId: _connectionId, 
  isActive: _isActive, 
  onUpdate: _onUpdate, 
  onClose: _onClose 
}: SchemaViewPanelProps) {
  const selectedSchema = tab.payload?.selectedSchema || "public";

  return (
    <div className="h-full overflow-auto p-4">
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Database className="h-5 w-5" />
            Schema: {selectedSchema}
          </h2>
        </div>

        {/* Schema Overview */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-muted/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Table className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Tables</span>
            </div>
            <p className="text-2xl font-bold">24</p>
          </div>
          
          <div className="p-4 bg-muted/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Columns className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Columns</span>
            </div>
            <p className="text-2xl font-bold">186</p>
          </div>
          
          <div className="p-4 bg-muted/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Indexes</span>
            </div>
            <p className="text-2xl font-bold">42</p>
          </div>
        </div>

        {/* Schema Details */}
        <div className="space-y-4">
          <h3 className="font-medium">Schema Structure</h3>
          <div className="text-sm text-muted-foreground">
            <p>Schema structure and details will be displayed here</p>
            <p className="mt-2">This panel will show:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Table relationships</li>
              <li>Column definitions</li>
              <li>Constraints and indexes</li>
              <li>Triggers and functions</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}