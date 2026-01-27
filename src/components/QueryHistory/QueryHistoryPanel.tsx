/**
 * Query History Panel
 *
 * Main panel component for query history and saved queries.
 * Contains search input and tabs for switching between views.
 */

import { useRef, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useQueryHistoryStore } from "@/stores/queryHistoryStore";
import { QueryHistoryList } from "./QueryHistoryList";
import { SavedQueriesList } from "./SavedQueriesList";
import { IconSearch, IconHistory, IconBookmark } from "@tabler/icons-react";
import { eventBus } from "@/services/eventBus";

export function QueryHistoryPanel() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { activeTab, setActiveTab, searchQuery, setSearchQuery } =
    useQueryHistoryStore();

  useEffect(() => {
    const handleFocusSearch = () => {
      searchInputRef.current?.focus();
    };

    eventBus.on("query-history:focus-search", handleFocusSearch);
    return () => {
      eventBus.off("query-history:focus-search", handleFocusSearch);
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-1">
        <div className="relative">
          <IconSearch className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder="Search queries..."
            className="pl-6 h-7 text-xs"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); }}
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => { setActiveTab(v as "history" | "saved"); }}
        className="flex-1 flex flex-col"
      >
        <TabsList className="mx-1 h-7">
          <TabsTrigger value="history" className="text-xs gap-1">
            <IconHistory className="h-3 w-3" />
            History
          </TabsTrigger>
          <TabsTrigger value="saved" className="text-xs gap-1">
            <IconBookmark className="h-3 w-3" />
            Saved
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="flex-1 mt-0 overflow-hidden">
          <QueryHistoryList />
        </TabsContent>

        <TabsContent value="saved" className="flex-1 mt-0 overflow-hidden">
          <SavedQueriesList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
