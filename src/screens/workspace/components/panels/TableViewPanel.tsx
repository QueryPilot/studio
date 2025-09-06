import { memo, useState, lazy, Suspense, useTransition, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Table, Bolt, BookMarked, Zap, Download } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy load heavy components
const TableDataGrid = lazy(() =>
  import("@/components/DataGrid").then((m) => ({ default: m.TableDataGrid })),
);
const TableStructure = lazy(() =>
  import("@/components/DataGrid/TableStructure").then((m) => ({
    default: m.TableStructure,
  })),
);
const TableIndexes = lazy(() =>
  import("@/components/DataGrid/TableIndexes").then((m) => ({
    default: m.TableIndexes,
  })),
);
const TableTriggers = lazy(() =>
  import("@/components/DataGrid/TableTriggers").then((m) => ({
    default: m.TableTriggers,
  })),
);

import type { TabState } from "@/types/workspaceScreen";

interface TableTabPayload {
  tableName: string;
  schema: string;
  database: string;
  isView?: boolean;
  kind?: "Table" | "View" | "MaterializedView";
  activeView?: "data" | "structure" | "indexes" | "triggers";
}

interface TableViewPanelProps {
  tab: TabState;
  connectionId: string;
  isActive: boolean;
  onUpdate: (updates: Partial<TabState>) => void;
  onClose: () => void;
}

// Loading skeleton for tab content
const TabLoadingSkeleton = () => (
  <div className="h-full w-full p-4 space-y-3">
    <div className="flex gap-4">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-8 w-28" />
    </div>
    {Array.from({ length: 10 }).map((_, i) => (
      <Skeleton key={i} className="h-10 w-full" />
    ))}
  </div>
);

export const TableViewPanel = memo(function TableViewPanel({
  tab,
  connectionId,
  isActive: _isActive,
  onUpdate,
  onClose: _onClose,
}: TableViewPanelProps) {
  const payload = tab.payload as TableTabPayload;
  const [activeTab, setActiveTab] = useState(payload.activeView || "data");
  const [isPending, startTransition] = useTransition();
  
  // Update active tab when payload changes
  useEffect(() => {
    if (payload.activeView && payload.activeView !== activeTab) {
      setActiveTab(payload.activeView);
    }
  }, [payload.activeView]);

  const tableName = payload.tableName || "Unknown Table";
  const schema = payload.schema || "public";
  const database = payload.database || "postgres";

  // Handle tab change with transition and update payload
  const handleTabChange = (value: string) => {
    const newTab = value as "data" | "structure" | "indexes" | "triggers";
    startTransition(() => {
      setActiveTab(newTab);
      // Update the payload to persist the active view
      onUpdate({
        payload: {
          ...payload,
          activeView: newTab,
        },
      });
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none border-b bg-background h-8">
        <div className="flex items-center justify-between px-1 h-full">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className={`h-6 p-0.5 ${isPending ? "opacity-60" : ""}`}>
              <TabsTrigger value="data" className="gap-1 text-xs h-5 px-2 py-0">
                <Table className="h-3 w-3" />
                Data
              </TabsTrigger>
              <TabsTrigger
                value="structure"
                className="gap-1 text-xs h-5 px-2 py-0"
              >
                <Bolt className="h-3 w-3" />
                Structure
              </TabsTrigger>
              <TabsTrigger
                value="indexes"
                className="gap-1 text-xs h-5 px-2 py-0"
              >
                <BookMarked className="h-3 w-3" />
                Indexes
              </TabsTrigger>
              <TabsTrigger
                value="triggers"
                className="gap-1 text-xs h-5 px-2 py-0"
              >
                <Zap className="h-3 w-3" />
                Triggers
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2 py-0"
            onClick={() => {}}
          >
            <Download className="h-3 w-3 mr-1" />
            Export
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        <Suspense fallback={<TabLoadingSkeleton />}>
          {/* Render all tab contents but only show the active one */}
          <div className={`absolute inset-0 ${activeTab === "data" ? "block" : "hidden"}`}>
            <TableDataGrid
              connectionId={connectionId}
              database={database}
              table={tableName}
              schema={schema}
            />
          </div>

          <div className={`absolute inset-0 ${activeTab === "structure" ? "block" : "hidden"}`}>
            <TableStructure
              connectionId={connectionId}
              database={database}
              table={tableName}
              schema={schema}
            />
          </div>

          <div className={`absolute inset-0 ${activeTab === "indexes" ? "block" : "hidden"}`}>
            <TableIndexes
              connectionId={connectionId}
              database={database}
              table={tableName}
              schema={schema}
            />
          </div>

          <div className={`absolute inset-0 ${activeTab === "triggers" ? "block" : "hidden"}`}>
            <TableTriggers
              connectionId={connectionId}
              database={database}
              table={tableName}
              schema={schema}
            />
          </div>
        </Suspense>
      </div>
    </div>
  );
});
