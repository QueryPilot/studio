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
} from "lucide-react";
import { useState } from "react";
import { useTabsStore } from "@/stores/tabsStore";

interface TreeItem {
  name: string;
  type: "table" | "view" | "function";
  children?: TreeItem[];
}

const mockData: TreeItem[] = [
  {
    name: "Tables",
    type: "table",
    children: [
      { name: "users", type: "table" },
      { name: "products", type: "table" },
      { name: "orders", type: "table" },
      { name: "order_items", type: "table" },
      { name: "categories", type: "table" },
    ],
  },
  {
    name: "Views",
    type: "view",
    children: [
      { name: "user_orders", type: "view" },
      { name: "product_sales", type: "view" },
    ],
  },
  {
    name: "Functions",
    type: "function",
    children: [
      { name: "calculate_total", type: "function" },
      { name: "update_inventory", type: "function" },
    ],
  },
];

export function DatabaseSidebar() {
  const [expanded, setExpanded] = useState<string[]>(["Tables"]);
  const [searchQuery, setSearchQuery] = useState("");
  const { addTab, tabs } = useTabsStore();

  const toggleExpand = (name: string) => {
    setExpanded((prev) =>
      prev.includes(name)
        ? prev.filter((item) => item !== name)
        : [...prev, name],
    );
  };

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
            placeholder="Search tables..."
            className="pl-8 h-8 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {mockData.map((category) => (
            <div key={category.name} className="mb-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start h-8 px-2"
                onClick={() => toggleExpand(category.name)}
              >
                {expanded.includes(category.name) ? (
                  <ChevronDown className="h-4 w-4 mr-1" />
                ) : (
                  <ChevronRight className="h-4 w-4 mr-1" />
                )}
                <span className="font-medium">{category.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {category.children?.length}
                </span>
              </Button>

              {expanded.includes(category.name) && category.children && (
                <div className="ml-4 mt-1">
                  {category.children
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
                        onClick={() => handleItemClick(item)}
                      >
                        {getIcon(item.type)}
                        <span className="ml-2">{item.name}</span>
                      </Button>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
