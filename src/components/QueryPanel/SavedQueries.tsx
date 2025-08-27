import { useEffect, useState } from "react";
import { queryHistoryService, type QueryHistoryEntry } from "@/services/queryHistoryService";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Star, Trash2, Edit, Search, X } from "lucide-react";
import { toast } from "sonner";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

interface SavedQueriesProps {
  connectionId: string;
  database: string;
  currentQuery?: string;
  onSelectQuery: (query: string) => void;
}

export function SavedQueries({
  connectionId,
  database,
  currentQuery: _currentQuery,
  onSelectQuery,
}: SavedQueriesProps) {
  const [favorites, setFavorites] = useState<QueryHistoryEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [editingFavorite, setEditingFavorite] = useState<{ id: number; currentName: string } | null>(null);
  const [favoriteName, setFavoriteName] = useState("");

  useEffect(() => {
    loadFavorites();
  }, [connectionId, database]);

  const loadFavorites = async () => {
    setIsLoading(true);
    try {
      const favoritesData = await queryHistoryService.getFavorites(connectionId, database);
      setFavorites(favoritesData);
    } catch (error) {
      console.error("Failed to load favorites:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    if (searchTerm.trim()) {
      const allFavorites = await queryHistoryService.getFavorites(connectionId, database);
      const filtered = allFavorites.filter(fav => 
        fav.query.toLowerCase().includes(searchTerm.toLowerCase()) ||
        fav.name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFavorites(filtered);
    } else {
      loadFavorites();
    }
  };

  const handleUpdateName = async () => {
    if (editingFavorite && favoriteName.trim()) {
      try {
        await queryHistoryService.updateFavoriteName(editingFavorite.id, favoriteName.trim());
        toast.success("Favorite name updated");
        setEditingFavorite(null);
        setFavoriteName("");
        loadFavorites();
      } catch (error) {
        toast.error("Failed to update favorite name");
      }
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await queryHistoryService.toggleFavorite(id);
      toast.success("Removed from favorites");
      loadFavorites();
    } catch (error) {
      toast.error("Failed to remove from favorites");
    }
  };

  const handleEdit = (favorite: QueryHistoryEntry) => {
    setEditingFavorite({ id: favorite.id!, currentName: favorite.name || '' });
    setFavoriteName(favorite.name || '');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading favorites...</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search favorites..."
                className="pl-8 h-8"
              />
              {searchTerm && (
                <Button
                  onClick={() => {
                    setSearchTerm("");
                    loadFavorites();
                  }}
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {favorites.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <Star className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No favorite queries yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Star queries from the history to see them here
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-2">
              {favorites.map((favorite) => (
                <div
                  key={favorite.id}
                  className="group relative p-3 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => onSelectQuery(favorite.query)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                        <h4 className="font-medium text-sm">
                          {favorite.name || 'Untitled Query'}
                        </h4>
                      </div>
                      <pre className="font-mono text-xs whitespace-pre-wrap break-all text-muted-foreground">
                        {favorite.query.length > 150
                          ? `${favorite.query.substring(0, 150)}...`
                          : favorite.query}
                      </pre>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-muted-foreground">
                          {dayjs(favorite.executedAt).fromNow()}
                        </span>
                        {favorite.rowCount !== undefined && (
                          <span className="text-xs text-muted-foreground">
                            {favorite.rowCount} rows
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(favorite);
                        }}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(favorite.id!);
                        }}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Edit Favorite Name Dialog */}
      <Dialog open={!!editingFavorite} onOpenChange={(open) => {
        if (!open) {
          setEditingFavorite(null);
          setFavoriteName("");
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Favorite Name</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={favoriteName}
                onChange={(e) => setFavoriteName(e.target.value)}
                placeholder="Enter a name for this query..."
                className="mt-1"
                onKeyDown={(e) => e.key === "Enter" && handleUpdateName()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditingFavorite(null);
                  setFavoriteName("");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpdateName}
                disabled={!favoriteName.trim()}
              >
                Update
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}