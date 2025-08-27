import { memo, useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { TableDataRow } from '@/services/tableDataTypes';
import type { ColumnMeta } from '@/types/database';

interface GridDataPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  selectedRows: TableDataRow[];
  columns: ColumnMeta[];
  className?: string;
}

export const GridDataPreview = memo(function GridDataPreview({
  isOpen,
  onClose,
  selectedRows,
  columns,
  className,
}: GridDataPreviewProps) {
  const [height, setHeight] = useState(200);
  const [isResizing, setIsResizing] = useState(false);
  const [activeTab, setActiveTab] = useState('preview');

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = document.querySelector('[data-grid-container]');
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const newHeight = containerRect.bottom - e.clientY;
      setHeight(Math.max(100, Math.min(400, newHeight)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "absolute bottom-0 left-0 right-0 bg-background border-t border-border/50 shadow-lg z-10",
        className
      )}
      style={{ height: `${height}px` }}
    >
      {/* Resize handle */}
      <div
        className="absolute -top-0.5 left-0 right-0 h-1 cursor-ns-resize hover:bg-primary/20 group"
        onMouseDown={() => setIsResizing(true)}
      >
        <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-px bg-border/50 group-hover:bg-primary/30" />
      </div>

      {/* Header with tabs */}
      <div className="flex items-center justify-between h-8 border-b px-2">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
          <TabsList className="h-7 p-0.5">
            <TabsTrigger value="preview" className="text-xs px-3 h-6">Preview</TabsTrigger>
            <TabsTrigger value="json" className="text-xs px-3 h-6">JSON</TabsTrigger>
          </TabsList>
        </Tabs>
        
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {selectedRows.length} row{selectedRows.length !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={onClose}
            className="p-0.5 hover:bg-accent rounded-sm"
            title="Close preview"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-auto" style={{ height: height - 32 }}>
        {activeTab === 'preview' ? (
          <PreviewTab
            selectedRows={selectedRows}
            columns={columns}
          />
        ) : (
          <JsonTab selectedRows={selectedRows} />
        )}
      </div>
    </div>
  );
});

const PreviewTab = memo(function PreviewTab({
  selectedRows,
  columns,
}: {
  selectedRows: TableDataRow[];
  columns: ColumnMeta[];
}) {
  if (selectedRows.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-4 text-xs">
        No rows selected
      </div>
    );
  }

  const isSingleRow = selectedRows.length === 1;
  const row = selectedRows[0];
  
  if (!row) {
    return (
      <div className="text-center text-muted-foreground py-4 text-xs">
        No data available
      </div>
    );
  }

  return (
    <div className="overflow-auto px-2 py-1">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className="text-left px-2 py-1 text-[10px] font-semibold text-muted-foreground">
              Column
            </th>
            <th className="text-left px-2 py-1 text-[10px] font-semibold text-muted-foreground">
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => {
            const value = row[column.name];
            const hasMultipleValues = !isSingleRow && 
              selectedRows.some(r => r[column.name] !== value);

            return (
              <tr key={column.name} className="border-b hover:bg-muted/30">
                <td className="px-2 py-1 text-[10px] font-medium">
                  {column.name}
                  {column.is_pk && (
                    <span className="ml-1 text-[9px] px-0.5 py-0 bg-primary/20 text-primary rounded">
                      PK
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 text-[10px] font-mono">
                  {hasMultipleValues ? (
                    <span className="text-muted-foreground italic">
                      &lt;multiple values&gt;
                    </span>
                  ) : value === null ? (
                    <span className="text-muted-foreground italic">NULL</span>
                  ) : typeof value === 'boolean' ? (
                    <span className={value ? 'text-green-600' : 'text-red-600'}>
                      {String(value).toUpperCase()}
                    </span>
                  ) : typeof value === 'number' ? (
                    <span className="text-blue-600">{value}</span>
                  ) : typeof value === 'object' ? (
                    <span className="text-orange-600">{JSON.stringify(value)}</span>
                  ) : (
                    <span>{String(value)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

const JsonTab = memo(function JsonTab({
  selectedRows,
}: {
  selectedRows: TableDataRow[];
}) {
  const jsonString = JSON.stringify(selectedRows, null, 2);

  return (
    <div className="relative p-2">
      <pre className="text-[10px] overflow-auto p-2 bg-muted/20 rounded">
        <code>{highlightJson(jsonString)}</code>
      </pre>
    </div>
  );
});

function highlightJson(json: string): React.ReactNode {
  // Simple JSON syntax highlighting
  const lines = json.split('\n');
  
  return lines.map((line, index) => {
    const highlighted = line
      .replace(/"([^"]+)":/g, (_match, key) => {
        return `<span class="text-blue-600 dark:text-blue-400">"${key}"</span>:`;
      })
      .replace(/: "([^"]*)"/g, (_match, value) => {
        return `: <span class="text-green-600 dark:text-green-400">"${value}"</span>`;
      })
      .replace(/: (\d+\.?\d*)/g, (_match, num) => {
        return `: <span class="text-purple-600 dark:text-purple-400">${num}</span>`;
      })
      .replace(/: (true|false)/g, (_match, bool) => {
        return `: <span class="text-orange-600 dark:text-orange-400">${bool}</span>`;
      })
      .replace(/: null/g, () => {
        return `: <span class="text-gray-500">null</span>`;
      });
    
    return (
      <div key={index} dangerouslySetInnerHTML={{ __html: highlighted }} />
    );
  });
}