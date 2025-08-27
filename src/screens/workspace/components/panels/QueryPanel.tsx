import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import type { TabState } from "@/types/workspaceScreen";

// Lazy load the QueryPanel to reduce initial bundle size
const MonacoQueryPanel = lazy(() => 
  import("@/components/QueryPanel").then(module => ({ 
    default: module.QueryPanel 
  }))
);

interface QueryPanelProps {
  tab: TabState;
  connectionId: string;
  isActive: boolean;
  onUpdate: (updates: Partial<TabState>) => void;
  onClose: () => void;
}

export function QueryPanel({ 
  tab, 
  connectionId, 
  isActive: _isActive, 
  onUpdate: _onUpdate, 
  onClose: _onClose 
}: QueryPanelProps) {
  // Extract database info from tab payload
  const database = tab.payload?.database || tab.context?.database || '';
  const schema = tab.payload?.schema || tab.context?.schema || 'public';
  const dbType = tab.payload?.dbType || tab.context?.dbType || 'postgres';

  return (
    <Suspense 
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center space-y-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading Query Editor...</p>
          </div>
        </div>
      }
    >
      <MonacoQueryPanel
        connectionId={connectionId}
        database={database}
        schema={schema}
        dbType={dbType}
        className="h-full"
      />
    </Suspense>
  );
}