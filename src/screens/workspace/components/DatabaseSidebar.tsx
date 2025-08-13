import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  ChevronDown,
  Table,
  Eye,
  Code,
  Search,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useTabsStore } from "@/stores/tabsStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { databaseService } from "@/services/database";
import type { TableInfo, ViewInfo, FunctionInfo } from "@/services/database";

interface TreeItem {
  name: string;
  type: "table" | "view" | "function";
  children?: TreeItem[];
}

interface DatabaseSidebarProps {
  workspaceId?: string;
  priorityConnectionId?: string | null;
}

export function DatabaseSidebar({ workspaceId, priorityConnectionId }: DatabaseSidebarProps) {
  const [expanded, setExpanded] = useState<string[]>(["Tables"]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [views, setViews] = useState<ViewInfo[]>([]);
  const [functions, setFunctions] = useState<FunctionInfo[]>([]);
  const { addTab, tabs } = useTabsStore();
  const { connections, activeConnectionId } = useConnectionStore();
  
  const activeConnection = activeConnectionId 
    ? connections.get(activeConnectionId)
    : null;

  const toggleExpand = (name: string) => {
    setExpanded((prev) =>
      prev.includes(name)
        ? prev.filter((item) => item !== name)
        : [...prev, name],
    );
  };
  
  const loadDatabaseSchema = async () => {
    if (!activeConnection || activeConnection.status !== "connected") return;
    
    setIsLoadingSchema(true);
    try {
      const [tablesData, viewsData, functionsData] = await Promise.all([
        databaseService.getTables(
          activeConnection.config,
          activeConnection.config.database
        ),
        databaseService.getViews(
          activeConnection.config,
          activeConnection.config.database
        ),
        databaseService.getFunctions(
          activeConnection.config,
          activeConnection.config.database
        ),
      ]);
      
      setTables(tablesData);
      setViews(viewsData);
      setFunctions(functionsData);
    } catch (error) {
      console.error("Error loading schema:", error);
    } finally {
      setIsLoadingSchema(false);
    }
  };
  
  useEffect(() => {
    if (activeConnectionId) {
      loadDatabaseSchema();
    } else {
      setTables([]);
      setViews([]);
      setFunctions([]);
    }
  }, [activeConnectionId, activeConnection?.status]);

  const handleItemClick = (item: TreeItem) => {
    // Check if tab already exists
    const existingTab = tabs.find(
      (tab) => tab.name === item.name && tab.type === item.type,
    );
    if (!existingTab) {
      addTab({ name: item.name, type: item.type });
    } else {
      // If tab exists, just set it as active
      useTabsStore.getState().setActiveTab(existingTab.id);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "table":
        return <Table className="h-4 w-4 text-blue-500" />;
      case "view":
        return <Eye className="h-4 w-4 text-green-500" />;
      case "function":
        return <Code className="h-4 w-4 text-purple-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col bg-muted/30">
      <div className="p-1 pb-0.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search schema objects..."
            className="pl-8 h-8 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* Database Objects - Only show when connected */}
          {activeConnectionId && activeConnection?.status === "connected" ? (
            isLoadingSchema ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Loading schema...</span>
              </div>
            ) : (
              <>
                  <div className="flex items-center justify-between mb-1 px-2">
                    <span className="text-xs font-medium text-muted-foreground">Database Objects</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={loadDatabaseSchema}
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  </div>
                  
                  {/* Tables */}
                  <div className="mb-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start h-8 px-2"
                      onClick={() => toggleExpand("Tables")}
                    >
                      {expanded.includes("Tables") ? (
                        <ChevronDown className="h-4 w-4 mr-1" />
                      ) : (
                        <ChevronRight className="h-4 w-4 mr-1" />
                      )}
                      <span className="font-medium">Tables</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {tables.length}
                      </span>
                    </Button>

                    {expanded.includes("Tables") && (
                      <div className="ml-4 mt-1">
                        {tables
                          .filter((item) =>
                            item.name
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase()),
                          )
                          .map((item) => (
                            <Button
                              key={item.name}
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start h-7 px-2 mb-0.5 text-sm"
                              onClick={() => handleItemClick({ name: item.name, type: "table" })}
                            >
                              {getIcon("table")}
                              <span className="ml-2">{item.name}</span>
                            </Button>
                          ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Views */}
                  <div className="mb-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start h-8 px-2"
                      onClick={() => toggleExpand("Views")}
                    >
                      {expanded.includes("Views") ? (
                        <ChevronDown className="h-4 w-4 mr-1" />
                      ) : (
                        <ChevronRight className="h-4 w-4 mr-1" />
                      )}
                      <span className="font-medium">Views</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {views.length}
                      </span>
                    </Button>

                    {expanded.includes("Views") && (
                      <div className="ml-4 mt-1">
                        {views
                          .filter((item) =>
                            item.name
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase()),
                          )
                          .map((item) => (
                            <Button
                              key={item.name}
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start h-7 px-2 mb-0.5 text-sm"
                              onClick={() => handleItemClick({ name: item.name, type: "view" })}
                            >
                              {getIcon("view")}
                              <span className="ml-2">{item.name}</span>
                            </Button>
                          ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Functions */}
                  <div className="mb-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start h-8 px-2"
                      onClick={() => toggleExpand("Functions")}
                    >
                      {expanded.includes("Functions") ? (
                        <ChevronDown className="h-4 w-4 mr-1" />
                      ) : (
                        <ChevronRight className="h-4 w-4 mr-1" />
                      )}
                      <span className="font-medium">Functions</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {functions.length}
                      </span>
                    </Button>

                    {expanded.includes("Functions") && (
                      <div className="ml-4 mt-1">
                        {functions
                          .filter((item) =>
                            item.name
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase()),
                          )
                          .map((item) => (
                            <Button
                              key={item.name}
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start h-7 px-2 mb-0.5 text-sm"
                              onClick={() => handleItemClick({ name: item.name, type: "function" })}
                            >
                              {getIcon("function")}
                              <span className="ml-2">{item.name}</span>
                            </Button>
                          ))}
                      </div>
                    )}
                  </div>
                </>
              )
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Search className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground mb-2">No Database Connected</p>
              <p className="text-xs text-muted-foreground/70">
                Connect to a database to explore schema objects
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
