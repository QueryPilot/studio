import { useEffect, useState } from "react";
import { savedQueriesService, type SavedQuery } from "@/services/savedQueriesService";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Star,
  StarOff,
  Trash2,
  Edit,
  Save,
  Search,
  X,
  FileText,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  currentQuery,
  onSelectQuery,
}: SavedQueriesProps) {
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [editingQuery, setEditingQuery] = useState<SavedQuery | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    query: "",
    tags: "",
  });

  useEffect(() => {
    loadQueries();
  }, [connectionId, database]);

  const loadQueries = async () => {
    setIsLoading(true);
    try {
      const savedQueries = await savedQueriesService.getQueries(connectionId, database);
      setQueries(savedQueries);
    } catch (error) {
      console.error("Failed to load saved queries:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    if (searchTerm.trim()) {
      const results = await savedQueriesService.searchQueries(connectionId, searchTerm);
      setQueries(results);
    } else {
      loadQueries();
    }
  };

  const handleSave = async () => {
    const tags = formData.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (editingQuery) {
      await savedQueriesService.updateQuery(editingQuery.id!, {
        name: formData.name,
        description: formData.description,
        query: formData.query,
        tags,
      });
    } else {
      await savedQueriesService.saveQuery({
        connectionId,
        database,
        name: formData.name,
        description: formData.description,
        query: formData.query,
        tags,
        createdAt: new Date(),
        updatedAt: new Date(),
        isFavorite: false,
      });
    }

    setShowSaveDialog(false);
    setEditingQuery(null);
    setFormData({ name: "", description: "", query: "", tags: "" });
    loadQueries();
  };

  const handleEdit = (query: SavedQuery) => {
    setEditingQuery(query);
    setFormData({
      name: query.name,
      description: query.description || "",
      query: query.query,
      tags: query.tags?.join(", ") || "",
    });
    setShowSaveDialog(true);
  };

  const handleDelete = async (id: number) => {
    await savedQueriesService.deleteQuery(id);
    loadQueries();
  };

  const handleToggleFavorite = async (id: number) => {
    await savedQueriesService.toggleFavorite(id);
    loadQueries();
  };

  const openSaveDialog = () => {
    setEditingQuery(null);
    setFormData({
      name: "",
      description: "",
      query: currentQuery || "",
      tags: "",
    });
    setShowSaveDialog(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading saved queries...</p>
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
                placeholder="Search saved queries..."
                className="pl-8 h-8"
              />
              {searchTerm && (
                <Button
                  onClick={() => {
                    setSearchTerm("");
                    loadQueries();
                  }}
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            <Button
              onClick={openSaveDialog}
              variant="outline"
              size="sm"
              disabled={!currentQuery}
            >
              <Save className="h-3 w-3 mr-1" />
              Save
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {queries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No saved queries yet</p>
            </div>
          ) : (
            <div className="p-2 space-y-2">
              {queries.map((query) => (
                <div
                  key={query.id}
                  className="group relative p-3 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => onSelectQuery(query.query)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-sm">{query.name}</h4>
                        {query.isFavorite && (
                          <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                        )}
                      </div>
                      {query.description && (
                        <p className="text-xs text-muted-foreground mb-2">
                          {query.description}
                        </p>
                      )}
                      <pre className="font-mono text-xs whitespace-pre-wrap break-all text-muted-foreground">
                        {query.query.length > 150
                          ? `${query.query.substring(0, 150)}...`
                          : query.query}
                      </pre>
                      <div className="flex items-center gap-2 mt-2">
                        {query.tags?.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs py-0">
                            <Tag className="h-2 w-2 mr-1" />
                            {tag}
                          </Badge>
                        ))}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {dayjs(query.updatedAt).fromNow()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavorite(query.id!);
                        }}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                      >
                        {query.isFavorite ? (
                          <StarOff className="h-3 w-3" />
                        ) : (
                          <Star className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(query);
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
                          handleDelete(query.id!);
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

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingQuery ? "Edit Query" : "Save Query"}
            </DialogTitle>
            <DialogDescription>
              {editingQuery
                ? "Update the saved query details."
                : "Save this query for future use."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Query name"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Optional description"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Query</label>
              <Textarea
                value={formData.query}
                onChange={(e) => setFormData({ ...formData, query: e.target.value })}
                placeholder="SQL query"
                className="font-mono text-xs h-32"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Tags</label>
              <Input
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                placeholder="Comma-separated tags"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!formData.name || !formData.query}>
              {editingQuery ? "Update" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}