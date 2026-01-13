/**
 * Redis Key Browser Component
 *
 * Displays Redis keys with their values and provides editing capabilities.
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  IconRefresh,
  IconTrash,
  IconLoader2,
  IconKey,
  IconHash,
  IconList,
  IconBraces,
  IconClock,
  IconSortAscending,
  IconTimeline,
  IconArrowRight,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRedisStore } from "@/stores/redisStore";
import { StringEditor } from "./editors/StringEditor";
import { HashEditor } from "./editors/HashEditor";
import { ListEditor } from "./editors/ListEditor";
import { SetEditor } from "./editors/SetEditor";
import { usePanelStore } from "@/stores/panelStore";
import { v4 as uuidv4 } from "uuid";

interface KeyBrowserProps {
  connectionId: string;
  database: number;
  selectedKey?: string;
  className?: string;
}

type KeyType = "string" | "hash" | "list" | "set" | "zset" | "stream" | "unknown";

interface KeyDetails {
  key: string;
  type: KeyType;
  ttl: number;
  value: unknown;
}

export function KeyBrowser({
  connectionId,
  database: _database,
  selectedKey: initialKey,
  className,
}: KeyBrowserProps) {
  const [keyName, setKeyName] = useState(initialKey || "");
  const [keyDetails, setKeyDetails] = useState<KeyDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { 
    scannedKeys, 
    scanLoading, 
    scanComplete, 
    scanCursor, 
    fetchNextPage,
    scanPattern,
    setScanPattern,
    resetScan,
    setConnectionId
  } = useRedisStore();

  const { addTabToPanel, activePanelId } = usePanelStore();

  // Set connection ID in store
  useEffect(() => {
    setConnectionId(connectionId);
  }, [connectionId, setConnectionId]);

  // If no initial key, load the grid
  useEffect(() => {
    if (!initialKey && scannedKeys.length === 0 && !scanLoading && scanCursor === 0) {
      void fetchNextPage();
    }
  }, [initialKey, scannedKeys.length, scanLoading, scanCursor, fetchNextPage]);

  const fetchKeyDetails = useCallback(async () => {
    if (!keyName) {
      setKeyDetails(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get TTL
      const ttl = await invoke<number>("redis_ttl", {
        connId: connectionId,
        key: keyName,
      });

      if (ttl === -2) {
        setError("Key does not exist");
        setKeyDetails(null);
        return;
      }

      // Determine type first to avoid guessing
      const typeStr = await invoke<string>("redis_type", {
        connId: connectionId,
        key: keyName,
      });

      // Fetch value based on type
      let value: unknown = null;
      const type = typeStr.toLowerCase() as KeyType;

      if (type === "string") {
        value = await invoke<string | null>("redis_get", {
          connId: connectionId,
          key: keyName,
        });
      } else if (type === "hash") {
        value = await invoke<Record<string, string>>("redis_hgetall", {
          connId: connectionId,
          key: keyName,
        });
      } else if (type === "list") {
        value = await invoke<string[]>("redis_lrange", {
          connId: connectionId,
          key: keyName,
          start: 0,
          stop: -1,
        });
      } else if (type === "set") {
        value = await invoke<string[]>("redis_smembers", {
          connId: connectionId,
          key: keyName,
        });
      }
      
      // ZSet and Stream not yet supported in editor, show placeholder
      
      setKeyDetails({
        key: keyName,
        type,
        ttl,
        value,
      });

    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, keyName]);

  useEffect(() => {
    if (initialKey) {
      setKeyName(initialKey);
      void fetchKeyDetails();
    }
  }, [initialKey, fetchKeyDetails]);

  const handleDeleteKey = async () => {
    if (!keyName) return;

    try {
      await invoke("redis_delete", {
        connId: connectionId,
        key: keyName,
      });
      toast.success("Key deleted");
      setKeyDetails(null);
      setKeyName("");
    } catch (err) {
      toast.error(`Delete failed: ${err}`);
    }
  };

  const handleSetTTL = async (seconds: number) => {
    if (!keyName) return;

    try {
      await invoke("redis_expire", {
        connId: connectionId,
        key: keyName,
        seconds,
      });
      toast.success("TTL updated");
      void fetchKeyDetails();
    } catch (err) {
      toast.error(`Failed to set TTL: ${err}`);
    }
  };

  const handleKeyClick = (key: string) => {
    // Open in new tab
    const tabId = uuidv4();
    if (activePanelId) {
      addTabToPanel(activePanelId, {
        id: tabId,
        title: key,
        type: "redis-key",
        connectionId,
        payload: {
          database: String(_database), // Pass current DB
          tableName: key,
        },
      });
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "string":
        return <IconKey className="h-4 w-4 text-green-500" />;
      case "hash":
        return <IconHash className="h-4 w-4 text-blue-500" />;
      case "list":
        return <IconList className="h-4 w-4 text-purple-500" />;
      case "set":
        return <IconBraces className="h-4 w-4 text-orange-500" />;
      case "zset":
        return <IconSortAscending className="h-4 w-4 text-pink-500" />;
      case "stream":
        return <IconTimeline className="h-4 w-4 text-cyan-500" />;
      default:
        return <IconKey className="h-4 w-4 text-muted-foreground" />;
    }
  };

  // Render Editor if key is selected
  if (initialKey) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        {/* Header */}
        <div className="flex items-center gap-2 p-2 border-b">
          <IconKey className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1 font-mono text-sm font-medium truncate">{keyName}</div>
          <Button size="sm" variant="ghost" onClick={fetchKeyDetails} disabled={isLoading}>
            <IconRefresh className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
          {keyDetails && (
            <Button size="sm" variant="ghost" onClick={handleDeleteKey}>
              <IconTrash className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-destructive/10 text-destructive text-sm">{error}</div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Key Details */}
        {keyDetails && !isLoading && (
          <div className="flex-1 overflow-auto">
            {/* Meta Header */}
            <div className="flex items-center gap-3 p-3 border-b bg-muted/30">
              {getTypeIcon(keyDetails.type)}
              <div className="flex-1">
                <p className="text-xs text-muted-foreground capitalize">
                  Type: {keyDetails.type}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <IconClock className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs">
                  TTL: {keyDetails.ttl === -1 ? "No expiry" : `${keyDetails.ttl}s`}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs"
                  onClick={() => {
                    const ttl = prompt("Enter TTL in seconds:", "3600");
                    if (ttl) handleSetTTL(parseInt(ttl));
                  }}
                >
                  Set TTL
                </Button>
              </div>
            </div>

            {/* Value Editor */}
            <div className="p-3">
              {keyDetails.type === "string" && (
                <StringEditor
                  connectionId={connectionId}
                  keyName={keyDetails.key}
                  value={keyDetails.value as string}
                  onUpdate={fetchKeyDetails}
                />
              )}
              {keyDetails.type === "hash" && (
                <HashEditor
                  connectionId={connectionId}
                  keyName={keyDetails.key}
                  value={keyDetails.value as Record<string, string>}
                  onUpdate={fetchKeyDetails}
                />
              )}
              {keyDetails.type === "list" && (
                <ListEditor
                  connectionId={connectionId}
                  keyName={keyDetails.key}
                  value={keyDetails.value as string[]}
                  onUpdate={fetchKeyDetails}
                />
              )}
              {keyDetails.type === "set" && (
                <SetEditor
                  connectionId={connectionId}
                  keyName={keyDetails.key}
                  value={keyDetails.value as string[]}
                  onUpdate={fetchKeyDetails}
                />
              )}
              {(keyDetails.type === "zset" || keyDetails.type === "stream" || keyDetails.type === "unknown") && (
                <div className="text-sm text-muted-foreground">
                  Unsupported key type for editing: {keyDetails.type}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Render Key Grid
  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b">
        <Input 
          placeholder="Filter keys (e.g. user:*)" 
          value={scanPattern}
          onChange={(e) => setScanPattern(e.target.value)}
          className="h-7 text-xs font-mono w-64"
        />
        <Button 
          size="sm" 
          variant="ghost" 
          onClick={() => { resetScan(); void fetchNextPage(); }} 
          disabled={scanLoading}
        >
          <IconRefresh className={cn("h-4 w-4", scanLoading && "animate-spin")} />
        </Button>
      </div>

      {/* Grid Header */}
      <div className="grid grid-cols-12 gap-2 p-2 border-b bg-muted/30 text-xs font-medium text-muted-foreground">
        <div className="col-span-6">Key</div>
        <div className="col-span-2">Type</div>
        <div className="col-span-2">TTL</div>
        <div className="col-span-2">Size</div>
      </div>

      {/* Grid Body */}
      <div className="flex-1 overflow-auto">
        {scannedKeys.length === 0 && !scanLoading ? (
          <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
            No keys found matching pattern
          </div>
        ) : (
          scannedKeys.map((key) => (
            <div 
              key={key.key}
              className="grid grid-cols-12 gap-2 p-2 border-b hover:bg-muted/50 cursor-pointer text-xs items-center"
              onClick={() => handleKeyClick(key.key)}
            >
              <div className="col-span-6 font-mono truncate flex items-center gap-2">
                {getTypeIcon(key.keyType)}
                <span title={key.key}>{key.key}</span>
              </div>
              <div className="col-span-2 capitalize text-muted-foreground">{key.keyType}</div>
              <div className="col-span-2 text-muted-foreground">
                {key.ttl === -1 ? "Persistent" : `${key.ttl}s`}
              </div>
              <div className="col-span-2 text-muted-foreground text-[10px]">
                {key.sizeBytes ? `${key.sizeBytes} B` : "-"}
              </div>
            </div>
          ))
        )}
        
        {/* Loading Indicator */}
        {scanLoading && (
          <div className="flex items-center justify-center p-4">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Load More */}
        {!scanLoading && !scanComplete && scannedKeys.length > 0 && (
          <div className="p-2 flex justify-center">
            <Button size="sm" variant="outline" onClick={() => void fetchNextPage()}>
              Load More <IconArrowRight className="ml-2 h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

