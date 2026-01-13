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
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StringEditor } from "./editors/StringEditor";
import { HashEditor } from "./editors/HashEditor";
import { ListEditor } from "./editors/ListEditor";
import { SetEditor } from "./editors/SetEditor";

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

      // For now, assume string type and try to get it
      // A full implementation would use TYPE command first
      const value = await invoke<string | null>("redis_get", {
        connId: connectionId,
        key: keyName,
      });

      if (value !== null) {
        setKeyDetails({
          key: keyName,
          type: "string",
          ttl,
          value,
        });
        return;
      }

      // Try hash
      const hashValue = await invoke<Record<string, string>>("redis_hgetall", {
        connId: connectionId,
        key: keyName,
      });

      if (Object.keys(hashValue).length > 0) {
        setKeyDetails({
          key: keyName,
          type: "hash",
          ttl,
          value: hashValue,
        });
        return;
      }

      // Try list
      const listValue = await invoke<string[]>("redis_lrange", {
        connId: connectionId,
        key: keyName,
        start: 0,
        stop: -1,
      });

      if (listValue.length > 0) {
        setKeyDetails({
          key: keyName,
          type: "list",
          ttl,
          value: listValue,
        });
        return;
      }

      // Try set
      const setValue = await invoke<string[]>("redis_smembers", {
        connId: connectionId,
        key: keyName,
      });

      if (setValue.length > 0) {
        setKeyDetails({
          key: keyName,
          type: "set",
          ttl,
          value: setValue,
        });
        return;
      }

      // Unknown or empty
      setKeyDetails({
        key: keyName,
        type: "unknown",
        ttl,
        value: null,
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
    }
  }, [initialKey]);

  useEffect(() => {
    void fetchKeyDetails();
  }, [fetchKeyDetails]);

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

  const getTypeIcon = (type: KeyType) => {
    switch (type) {
      case "string":
        return <IconKey className="h-4 w-4 text-green-500" />;
      case "hash":
        return <IconHash className="h-4 w-4 text-blue-500" />;
      case "list":
        return <IconList className="h-4 w-4 text-purple-500" />;
      case "set":
        return <IconBraces className="h-4 w-4 text-orange-500" />;
      default:
        return <IconKey className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Key Input */}
      <div className="flex items-center gap-2 p-2 border-b">
        <IconKey className="h-4 w-4 text-muted-foreground" />
        <Input
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
          placeholder="Enter key name..."
          className="h-7 text-xs font-mono flex-1"
          onKeyDown={(e) => e.key === "Enter" && fetchKeyDetails()}
        />
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
          {/* Header */}
          <div className="flex items-center gap-3 p-3 border-b bg-muted/30">
            {getTypeIcon(keyDetails.type)}
            <div className="flex-1">
              <h3 className="font-mono text-sm font-medium">{keyDetails.key}</h3>
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
            {keyDetails.type === "unknown" && (
              <div className="text-sm text-muted-foreground">
                Unsupported key type or empty value
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!keyDetails && !isLoading && !error && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Enter a key name to view its value
        </div>
      )}
    </div>
  );
}
