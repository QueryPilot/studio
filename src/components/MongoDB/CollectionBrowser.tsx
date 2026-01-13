/**
 * MongoDB Collection Browser Component
 *
 * Displays documents from a MongoDB collection in a grid view with
 * support for filtering, pagination, and document editing.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  IconRefresh,
  IconFilter,
  IconPlus,
  IconTrash,
  IconChevronLeft,
  IconChevronRight,
  IconLoader2,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DocumentEditor } from "./DocumentEditor";

interface CollectionBrowserProps {
  connectionId: string;
  database: string;
  collection: string;
  className?: string;
}

const PAGE_SIZE = 50;

export function CollectionBrowser({
  connectionId,
  database: _database,
  collection,
  className,
}: CollectionBrowserProps) {
  const [documents, setDocuments] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("{}");
  const [filterInput, setFilterInput] = useState("{}");
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<Record<string, unknown> | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Parse filter
      let filterObj = {};
      try {
        filterObj = JSON.parse(filter);
      } catch {
        // Invalid JSON, use empty filter
      }

      const docs = await invoke<Record<string, unknown>[]>("mongo_find_documents", {
        connId: connectionId,
        collection,
        filter: filterObj,
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      });

      // Get count
      const count = await invoke<number>("mongo_count_documents", {
        connId: connectionId,
        collection,
        filter: filterObj,
      });

      setDocuments(docs);
      setTotalCount(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast.error("Failed to fetch documents");
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, collection, filter, page]);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  const handleApplyFilter = () => {
    try {
      JSON.parse(filterInput);
      setFilter(filterInput);
      setPage(0);
    } catch {
      toast.error("Invalid JSON filter");
    }
  };

  const handleDeleteDocument = async (doc: Record<string, unknown>) => {
    if (!doc._id) {
      toast.error("Cannot delete document without _id");
      return;
    }

    try {
      await invoke("mongo_delete_document", {
        connId: connectionId,
        collection,
        filter: { _id: doc._id },
      });
      toast.success("Document deleted");
      void fetchDocuments();
    } catch (err) {
      toast.error(`Delete failed: ${err}`);
    }
  };

  const handleCreateDocument = () => {
    setSelectedDoc({});
    setIsEditorOpen(true);
  };

  const handleEditDocument = (doc: Record<string, unknown>) => {
    setSelectedDoc(doc);
    setIsEditorOpen(true);
  };

  const handleSaveDocument = async (doc: Record<string, unknown>) => {
    try {
      if (doc._id) {
        // Update existing
        const { _id, ...updateFields } = doc;
        await invoke("mongo_update_document", {
          connId: connectionId,
          collection,
          filter: { _id },
          update: { $set: updateFields },
        });
        toast.success("Document updated");
      } else {
        // Insert new
        await invoke("mongo_insert_document", {
          connId: connectionId,
          collection,
          document: doc,
        });
        toast.success("Document created");
      }
      setIsEditorOpen(false);
      void fetchDocuments();
    } catch (err) {
      toast.error(`Save failed: ${err}`);
    }
  };

  // Get all unique keys from documents for column headers
  const columns = useMemo(() => {
    const keys = new Set<string>();
    keys.add("_id");
    documents.forEach((doc) => {
      Object.keys(doc).forEach((key) => keys.add(key));
    });
    return Array.from(keys);
  }, [documents]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b">
        <div className="flex-1 flex items-center gap-2">
          <IconFilter className="h-4 w-4 text-muted-foreground" />
          <Input
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            placeholder='{"field": "value"}'
            className="h-7 text-xs font-mono max-w-md"
            onKeyDown={(e) => e.key === "Enter" && handleApplyFilter()}
          />
          <Button size="sm" variant="secondary" onClick={handleApplyFilter}>
            Apply
          </Button>
        </div>
        <Button size="sm" variant="ghost" onClick={handleCreateDocument}>
          <IconPlus className="h-4 w-4 mr-1" />
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={fetchDocuments} disabled={isLoading}>
          <IconRefresh className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      {/* Loading */}
      {isLoading && documents.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Document Grid */}
      {!isLoading && documents.length === 0 && !error && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          No documents found
        </div>
      )}

      {documents.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background border-b">
              <tr>
                <th className="p-2 text-left font-medium w-10">#</th>
                {columns.slice(0, 8).map((col) => (
                  <th key={col} className="p-2 text-left font-medium truncate max-w-[200px]">
                    {col}
                  </th>
                ))}
                <th className="p-2 text-right font-medium w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc, idx) => (
                <tr
                  key={String(doc._id) || idx}
                  className="border-b hover:bg-accent/50 cursor-pointer"
                  onClick={() => handleEditDocument(doc)}
                >
                  <td className="p-2 text-muted-foreground">{page * PAGE_SIZE + idx + 1}</td>
                  {columns.slice(0, 8).map((col) => (
                    <td key={col} className="p-2 truncate max-w-[200px] font-mono">
                      {formatValue(doc[col])}
                    </td>
                  ))}
                  <td className="p-2 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDocument(doc);
                      }}
                    >
                      <IconTrash className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between p-2 border-t text-xs">
        <span className="text-muted-foreground">
          {totalCount} documents
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <IconChevronLeft className="h-4 w-4" />
          </Button>
          <span>
            Page {page + 1} of {totalPages || 1}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            <IconChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Document Editor Sheet */}
      {isEditorOpen && (
        <DocumentEditor
          document={selectedDoc || {}}
          isOpen={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          onSave={handleSaveDocument}
        />
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return `[${value.length} items]`;
    }
    return JSON.stringify(value).slice(0, 50) + "...";
  }
  return String(value);
}
