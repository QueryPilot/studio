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
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { QueryHistoryList } from "./QueryHistoryList";
import { SavedQueriesList } from "./SavedQueriesList";
import { IconSearch, IconHistory, IconBookmark } from "@tabler/icons-react";
import { eventBus } from "@/services/eventBus";

export function QueryHistoryPanel() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeTab = useQueryHistoryStore((s) => s.activeTab);
  const setActiveTab = useQueryHistoryStore((s) => s.setActiveTab);
  const searchQuery = useQueryHistoryStore((s) => s.searchQuery);
  const setSearchQuery = useQueryHistoryStore((s) => s.setSearchQuery);
  const setFilterProfileIds = useQueryHistoryStore((s) => s.setFilterProfileIds);
  const connectionIds = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.config.connectionIds ?? null,
  );

  // Filter history by workspace connections
  useEffect(() => {
    setFilterProfileIds(connectionIds);
  }, [connectionIds, setFilterProfileIds]);

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
        <TabsList className="w-full h-7 px-1">
          <TabsTrigger value="history" className="flex-1 text-xs gap-1">
            <IconHistory className="h-3 w-3" />
            History
          </TabsTrigger>
          <TabsTrigger value="saved" className="flex-1 text-xs gap-1">
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
