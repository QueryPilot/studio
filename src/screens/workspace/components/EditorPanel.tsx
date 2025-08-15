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
import { useTabsStore } from "@/stores/tabsStore";
import { useEffect, useRef, useState } from "react";
import { QueryWorkspace } from "@/components/QueryWorkspace";
import { DataViewer } from "@/components/DataViewer";

export function EditorPanel() {
  const { tabs, activeTab, setActiveTab, removeTab, addTab } = useTabsStore();
  const [visibleTabs, setVisibleTabs] = useState<typeof tabs>([]);
  const [overflowTabs, setOverflowTabs] = useState<typeof tabs>([]);
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  const getIcon = (type: string) => {
    switch (type) {
      case "query":
        return <FileText className="h-3.5 w-3.5 mr-1.5 flex-shrink-0" />;
      case "table":
        return <TableIcon className="h-3.5 w-3.5 mr-1.5 flex-shrink-0" />;
      case "view":
        return <Eye className="h-3.5 w-3.5 mr-1.5 flex-shrink-0" />;
      case "function":
        return <Code className="h-3.5 w-3.5 mr-1.5 flex-shrink-0" />;
      default:
        return null;
    }
  };

  const handleNewQuery = () => {
    const queryCount = tabs.filter((t) => t.type === "query").length;
    addTab({ name: `Query ${queryCount + 1}`, type: "query" });
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
      const getTabWidth = (tab: (typeof tabs)[0]) => {
        // Icon (16) + margin (4) + text + close button (16) + margin (6) + padding (16)
        const baseWidth = 58;
        const charWidth = 6.5; // More accurate character width
        return baseWidth + tab.name.length * charWidth;
      };

      // Calculate total width needed for all tabs
      const totalTabsWidth = tabs.reduce(
        (sum, tab) => sum + getTabWidth(tab),
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
      const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);

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
          if (tab && tab.id === activeTab && visibleTabIds.length > 0) {
            // Remove the last visible tab to make room for active
            const removedId = visibleTabIds.pop();
            if (removedId) {
              const removedTab = tabs.find((t) => t.id === removedId);
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
      const visible = tabs.filter((tab) => visibleTabIds.includes(tab.id));
      const overflow = tabs.filter((tab) => !visibleTabIds.includes(tab.id));

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
        onValueChange={setActiveTab}
        className="h-full flex flex-col"
      >
        <div
          className="flex items-center h-10 bg-muted/50"
          ref={tabsContainerRef}
        >
          <TabsList className="h-10 flex-1 inline-flex items-center justify-start rounded-none bg-muted p-0.5 gap-0 overflow-hidden">
            {visibleTabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="text-sm data-[state=active]:shadow-sm h-8 px-3 py-1.5 gap-0"
              >
                {getIcon(tab.type)}
                <span>{tab.name}</span>
                <div
                  className="h-4 w-4 p-0 ml-2 hover:bg-transparent opacity-60 hover:opacity-100 cursor-pointer flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTab(tab.id);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
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
                  className="h-8 px-2 ml-0.5 flex-none"
                >
                  <ChevronDown className="h-4 w-4" />
                  <span className="ml-0.5 text-sm">{overflowTabs.length}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {overflowTabs.map((tab) => (
                  <DropdownMenuItem
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="text-sm"
                  >
                    {getIcon(tab.type)}
                    <span>{tab.name}</span>
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
            className="h-10 w-10 p-0 ml-0.5 flex-none"
            onClick={handleNewQuery}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {tabs.map((tab) => {
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
                <DataViewer tableName={tab.name} schema={tab.schema} />
              ) : tab.type === "view" ? (
                <DataViewer tableName={tab.name} schema={tab.schema} />
              ) : (
                <ScrollArea className="h-full">
                  <div className="p-4">
                    <div className="text-muted-foreground">
                      {tab.type === "function" &&
                        `Function definition for '${tab.name}' will be displayed here`}
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
