/**
 * Redis Stream Viewer
 */

import { IconClock } from "@tabler/icons-react";

interface StreamEntry {
  id: string;
  fields: Record<string, string>;
}

interface StreamViewerProps {
  connectionId: string;
  keyName: string;
  value: StreamEntry[];
}

export function StreamViewer({ value }: StreamViewerProps) {
  const formatEntryId = (id: string): string => {
    const [timestamp] = id.split("-");
    if (!timestamp) return id;
    const date = new Date(parseInt(timestamp, 10));
    if (isNaN(date.getTime())) return id;
    return date.toLocaleString();
  };

  return (
    <div className="space-y-3">
      <div className="border rounded overflow-hidden">
        {value.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            No entries
          </div>
        ) : (
          <div className="divide-y max-h-96 overflow-auto">
            {value.map((entry) => (
              <div key={entry.id} className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <IconClock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono text-xs text-muted-foreground">
                    {entry.id}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({formatEntryId(entry.id)})
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-5">
                  {Object.entries(entry.fields).map(([field, fieldValue]) => (
                    <div key={field} className="contents">
                      <span className="font-mono text-xs font-medium truncate">
                        {field}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground truncate">
                        {fieldValue}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {value.length} entry/entries (read-only view)
      </p>
    </div>
  );
}
