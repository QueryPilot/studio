export interface StreamEntry {
  id: string;
  fields: Record<string, string>;
}

interface StreamViewerProps {
  connectionId: string;
  keyName: string;
  value: StreamEntry[];
  onUpdate: () => void;
}

export function StreamViewer({
  value,
}: StreamViewerProps) {
  return (
    <div className="space-y-3">
      <div className="border rounded max-h-[400px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="p-2 text-left font-medium w-40">ID</th>
              <th className="p-2 text-left font-medium">Fields</th>
            </tr>
          </thead>
          <tbody>
            {value.map((entry) => (
              <tr key={entry.id} className="border-t align-top">
                <td className="p-2 font-mono text-xs whitespace-nowrap text-muted-foreground">
                  {entry.id}
                </td>
                <td className="p-2">
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    {Object.entries(entry.fields).map(([k, v]) => (
                      <div key={k} className="contents font-mono text-xs">
                        <span className="text-muted-foreground">{k}:</span>
                        <span className="break-all">{v}</span>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {value.length === 0 && (
              <tr>
                <td colSpan={2} className="p-4 text-center text-muted-foreground">
                  Empty stream
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {value.length} entry(s)
      </p>
    </div>
  );
}
