import { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download, Copy, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QueryResultsProps {
  data: any[];
  columns: string[];
  queryTime?: number;
  error?: string;
  className?: string;
}

export function QueryResults({ 
  data, 
  columns, 
  queryTime, 
  error,
  className 
}: QueryResultsProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 100;

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return data.slice(start, end);
  }, [data, currentPage]);

  const totalPages = Math.ceil(data.length / pageSize);

  const handleExport = (format: 'csv' | 'json') => {
    if (format === 'csv') {
      const csv = [
        columns.join(','),
        ...data.map(row => 
          columns.map(col => {
            const value = row[col];
            return typeof value === 'string' && value.includes(',') 
              ? `"${value}"` 
              : value;
          }).join(',')
        )
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `query_results_${Date.now()}.csv`;
      a.click();
    } else {
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `query_results_${Date.now()}.json`;
      a.click();
    }
  };

  const handleCopy = () => {
    const text = [
      columns.join('\t'),
      ...data.map(row => 
        columns.map(col => row[col]).join('\t')
      )
    ].join('\n');
    navigator.clipboard.writeText(text);
  };

  if (error) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <div className="p-4 bg-destructive/10 text-destructive">
          <div className="font-semibold mb-2">Query Error</div>
          <pre className="text-sm whitespace-pre-wrap">{error}</pre>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          No results to display
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b bg-muted/50">
        <div className="text-sm text-muted-foreground">
          {data.length} row{data.length !== 1 ? 's' : ''}
          {queryTime && ` • ${queryTime}ms`}
        </div>

        <div className="flex-1" />

        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleExport('csv')}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          CSV
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleExport('json')}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          JSON
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={handleCopy}
          className="gap-2"
        >
          <Copy className="h-4 w-4" />
          Copy
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column} className="font-mono text-xs">
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {columns.map((column) => (
                  <TableCell key={column} className="font-mono text-xs">
                    {formatCellValue(row[column])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between p-2 border-t">
          <div className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatCellValue(value: any): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}