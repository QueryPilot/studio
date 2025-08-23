import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  X,
  FileText,
  Table as TableIcon,
  Plus,
  Eye,
  Code,
  ChevronDown,
} from "lucide-react";
import { useEffect, useRef, useState, useMemo } from "react";
import logoUrl from "@/assets/logo.png";
import { QueryWorkspace } from "@/components/QueryWorkspace";
import { DataViewer } from "@/components/DataViewer";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useParams } from "react-router-dom";
import type { TabState } from "@/types/workspace";

export function EditorPanel() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const workspace = useWorkspaceStore((state) =>
    state.getWorkspace(workspaceId || ""),
  );
  const { addTab, removeTab, setActiveTab } = useWorkspaceStore();

  // Convert Map to array and maintain order - memoize to prevent infinite loops
  const tabs: TabState[] = useMemo(() => {
    return workspace
      ? workspace.tabOrder
          .map((id) => workspace.tabs.get(id))
          .filter((tab): tab is TabState => Boolean(tab))
      : [];
  }, [workspace]);

  const activeTab = workspace?.activeTabId || "";

  const [visibleTabs, setVisibleTabs] = useState<TabState[]>([]);
  const [overflowTabs, setOverflowTabs] = useState<TabState[]>([]);
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  const getIcon = (type: string) => {
    switch (type) {
      case "query":
        return <FileText className="h-3 w-3 mr-1 flex-shrink-0" />;
      case "table":
        return <TableIcon className="h-3 w-3 mr-1 flex-shrink-0" />;
      case "view":
        return <Eye className="h-3 w-3 mr-1 flex-shrink-0" />;
      case "function":
        return <Code className="h-3 w-3 mr-1 flex-shrink-0" />;
      default:
        return null;
    }
  };

  const handleNewQuery = () => {
    if (!workspaceId) return;
    const queryCount = tabs.filter((t: TabState) => t.type === "query").length;
    addTab(workspaceId, {
      type: "query",
      title: `Query ${String(queryCount + 1)}`,
      connectionId: workspace?.activeConnectionId || "",
      payload: {},
    });
  };

  useEffect(() => {
    const calculateVisibleTabs = () => {
      if (!tabsContainerRef.current) {
        setVisibleTabs(tabs);
        setOverflowTabs([]);
        return;
      }

      // Get actual container width and reserve minimal space for buttons
      const containerWidth = tabsContainerRef.current.offsetWidth;
      const plusButtonWidth = 30; // Space for + button
      const dropdownButtonWidth = 45; // Space for dropdown when needed

      // More accurate tab width estimation
      const getTabWidth = (tab: TabState) => {
        // Icon (16) + margin (4) + text + close button (16) + margin (6) + padding (16)
        const baseWidth = 58;
        const charWidth = 6.5; // More accurate character width
        return baseWidth + (tab.title || "").length * charWidth;
      };

      // Calculate total width needed for all tabs
      const totalTabsWidth = tabs.reduce(
        (sum: number, tab: TabState) => sum + getTabWidth(tab),
        0,
      );

      // We need overflow if total tabs width exceeds available space minus plus button
      const maxWidthWithoutOverflow = containerWidth - plusButtonWidth;
      const needsOverflow = totalTabsWidth > maxWidthWithoutOverflow;

      if (!needsOverflow) {
        setVisibleTabs(tabs);
        setOverflowTabs([]);
        return;
      }

      // Calculate available width when we need overflow
      const availableWidth =
        containerWidth - plusButtonWidth - dropdownButtonWidth;

      // Calculate how many tabs can fit
      let currentWidth = 0;
      const visibleTabIds: string[] = [];

      // Always try to show the active tab
      const activeIndex = tabs.findIndex(
        (tab: TabState) => tab.id === activeTab,
      );

      // First, try to fit as many tabs as possible
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        if (!tab) continue;
        const tabWidth = getTabWidth(tab);

        if (currentWidth + tabWidth <= availableWidth) {
          currentWidth += tabWidth;
          visibleTabIds.push(tab.id);
        } else {
          // Can't fit this tab, check if it's the active one
          if (tab.id === activeTab && visibleTabIds.length > 0) {
            // Remove the last visible tab to make room for active
            const removedId = visibleTabIds.pop();
            if (removedId) {
              const removedTab = tabs.find((t: TabState) => t.id === removedId);
              if (removedTab) {
                currentWidth -= getTabWidth(removedTab);
              }
              visibleTabIds.push(tab.id);
            }
          }
          break;
        }
      }

      // If active tab is not visible and beyond our current check, ensure it's visible
      if (activeIndex > -1 && !visibleTabIds.includes(activeTab)) {
        if (visibleTabIds.length > 0) {
          visibleTabIds.pop(); // Remove last to make room
          visibleTabIds.push(activeTab);
        }
      }

      // Build final arrays maintaining original order
      const visible = tabs.filter((tab: TabState) =>
        visibleTabIds.includes(tab.id),
      );
      const overflow = tabs.filter(
        (tab: TabState) => !visibleTabIds.includes(tab.id),
      );

      setVisibleTabs(visible);
      setOverflowTabs(overflow);
    };

    calculateVisibleTabs();
    window.addEventListener("resize", calculateVisibleTabs);

    // Use ResizeObserver for more accurate detection
    const observer = new ResizeObserver(calculateVisibleTabs);
    if (tabsContainerRef.current) {
      observer.observe(tabsContainerRef.current);
    }

    return () => {
      window.removeEventListener("resize", calculateVisibleTabs);
      observer.disconnect();
    };
  }, [tabs, activeTab]);

  return (
    <div className="h-full flex flex-col bg-background">
      <Tabs
        value={activeTab}
        onValueChange={(tabId) => {
          if (workspaceId) {
            setActiveTab(workspaceId, tabId);
          }
        }}
        className="h-full flex flex-col"
      >
        <div
          className="flex items-center h-8 bg-muted/50"
          ref={tabsContainerRef}
        >
          <TabsList className="h-8 flex-1 inline-flex items-center justify-start rounded-none bg-muted py-0.5 px-1 gap-0.5 overflow-hidden">
            {visibleTabs.map((tab: TabState) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="text-xs h-6 px-2 py-1 gap-0"
              >
                {getIcon(tab.type)}
                <span>{tab.title}</span>
                <div
                  className="h-3.5 w-3.5 p-0 ml-1.5 hover:bg-transparent opacity-60 hover:opacity-100 cursor-pointer flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (workspaceId) {
                      removeTab(workspaceId, tab.id);
                    }
                  }}
                >
                  <X className="h-3 w-3" />
                </div>
              </TabsTrigger>
            ))}
          </TabsList>

          {overflowTabs.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 ml-0.5 flex-none"
                >
                  <ChevronDown className="h-4 w-4" />
                  <span className="ml-0.5 text-xs">{overflowTabs.length}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {overflowTabs.map((tab: TabState) => (
                  <DropdownMenuItem
                    key={tab.id}
                    onClick={() => {
                      if (workspaceId) {
                        setActiveTab(workspaceId, tab.id);
                      }
                    }}
                    className="text-xs"
                  >
                    {getIcon(tab.type)}
                    <span>{tab.title}</span>
                    {tab.id === activeTab && (
                      <span className="ml-auto text-sm">●</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 ml-0.5 flex-none hover:bg-muted/50 rounded-md"
            onClick={handleNewQuery}
            title="New Query"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        {/* Show empty state when no active tab */}
        {!activeTab && (
          <div className="flex-1 flex items-center justify-center h-full bg-background">
            <div className="text-center text-muted-foreground">
              <img
                src={logoUrl}
                alt="DevDB Studio"
                className="h-32 w-32 mx-auto mb-4"
              />
              <h3 className="text-lg font-medium mb-2">
                Welcome to your workspace
              </h3>
              <p className="text-sm mb-6 max-w-md">
                Select a table or view from the sidebar to explore your data, or
                create a new query tab to get started.
              </p>
              <Button onClick={handleNewQuery} className="gap-2">
                <Plus className="h-4 w-4" />
                New Query
              </Button>
            </div>
          </div>
        )}

        {tabs.map((tab: TabState) => {
          // saving render performance
          if (tab.id !== activeTab) {
            return null;
          }

          return (
            <TabsContent
              key={tab.id}
              value={tab.id}
              className="flex-1 m-0 mt-0 h-full overflow-hidden"
            >
              {tab.type === "query" ? (
                <QueryWorkspace />
              ) : tab.type === "table" ? (
                <DataViewer
                  tableName={tab.payload.tableName || tab.title}
                  schema={tab.payload.schema}
                  connectionId={tab.connectionId}
                  initialViewMode={tab.payload.initialViewMode}
                />
              ) : tab.type === "schema" ? (
                <DataViewer
                  tableName={tab.payload.tableName || tab.title}
                  schema={tab.payload.schema}
                  connectionId={tab.connectionId}
                />
              ) : (
                <ScrollArea className="h-full">
                  <div className="p-4">
                    <div className="text-muted-foreground">
                      Content for '{tab.title}' will be displayed here
                    </div>
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
