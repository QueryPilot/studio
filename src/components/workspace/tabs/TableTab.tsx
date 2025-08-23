import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useTableData } from '@/hooks/useTableData';
import { DataViewer } from '@/components/DataViewer/DataViewer';
import { type TabState } from '@/types/workspace';
import {
  RefreshCw,
  Filter,
  Download,
  Plus,
  Trash2,
  Search,
} from 'lucide-react';

interface TableTabProps {
  tab: TabState;
  schema: string;
  tableName: string;
}

interface FilterState {
  column: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'greater_than' | 'less_than' | 'is_null' | 'is_not_null';
  value: string;
}

export function TableTab({ tab, schema, tableName }: TableTabProps) {
  const { updateTabPayload } = useWorkspaceStore();
  const workspace = useWorkspaceStore(s => s.getActiveWorkspace());
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterState[]>([]);
  const [pageSize] = useState(100);
  const [currentOffset, setCurrentOffset] = useState(0);

  // Data fetching
  const tableData = useTableData(
    tab.connectionId,
    schema,
    tableName,
    filters,
    undefined, // sort
    pageSize,
    currentOffset
  );


  // Derived state
  const hasData = tableData.data && tableData.data.rows.length > 0;
  const isLoading = tableData.isLoading;

  const handleRefresh = useCallback(() => {
    tableData.refetch();
  }, [tableData]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setCurrentOffset(0);
    
    // Convert search to a simple filter on all text columns
    if (query.trim()) {
      // This is a simplified implementation - in practice you'd want to
      // detect column types and apply appropriate search logic
      const searchFilters: FilterState[] = [{
        column: '*', // Wildcard for all columns
        operator: 'contains',
        value: query
      }];
      setFilters(searchFilters);
    } else {
      setFilters([]);
    }
  }, []);




  const handleAddFilter = useCallback(() => {
    setFilters(prev => [...prev, { column: '', operator: 'equals', value: '' }]);
  }, []);

  const handleRemoveFilter = useCallback((index: number) => {
    setFilters(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpdateFilter = useCallback((index: number, field: keyof FilterState, value: string) => {
    setFilters(prev => prev.map((filter, i) => 
      i === index ? { ...filter, [field]: value } : filter
    ));
  }, []);

  // Update tab title when table changes
  React.useEffect(() => {
    if (tableName && schema) {
      updateTabPayload(workspace!.id, tab.id, { 
        schema, 
        tableName,
      });
    }
  }, [schema, tableName, workspace, tab.id, updateTabPayload]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b bg-background/95 backdrop-blur">
        {/* Table Info */}
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {schema}.{tableName}
          </Badge>
          
          {tableData.data && (
            <Badge variant="secondary">
              {tableData.data.total_rows?.toLocaleString()} rows
            </Badge>
          )}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search table..."
            value={searchQuery}
            onChange={(e) => { handleSearch(e.target.value); }}
            className="pl-8"
          />
        </div>

        {/* Actions */}
        <Button
          onClick={handleRefresh}
          disabled={isLoading}
          size="sm"
          variant="outline"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>

        <Button
          onClick={handleAddFilter}
          size="sm"
          variant="outline"
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          Filter
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled
        >
          <Download className="h-4 w-4" />
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters */}
      {filters.length > 0 && (
        <div className="border-b p-2 space-y-2 bg-muted/20">
          <div className="text-sm font-medium">Filters:</div>
          {filters.map((filter, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                placeholder="Column"
                value={filter.column}
                onChange={(e) => { handleUpdateFilter(index, 'column', e.target.value); }}
                className="w-32"
              />
              <select
                value={filter.operator}
                onChange={(e) => { handleUpdateFilter(index, 'operator', e.target.value); }}
                className="px-2 py-1 border rounded text-sm"
              >
                <option value="equals">=</option>
                <option value="not_equals">≠</option>
                <option value="contains">contains</option>
                <option value="starts_with">starts with</option>
                <option value="ends_with">ends with</option>
                <option value="greater_than">{'>'}</option>
                <option value="less_than">{'<'}</option>
              </select>
              <Input
                placeholder="Value"
                value={filter.value}
                onChange={(e) => { handleUpdateFilter(index, 'value', e.target.value); }}
                className="flex-1"
              />
              <Button
                onClick={() => { handleRemoveFilter(index); }}
                size="sm"
                variant="ghost"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Data Viewer */}
      <div className="flex-1 min-h-0">
        {tab.error ? (
          <div className="p-4 bg-destructive/10 text-destructive">
            <h3 className="font-medium mb-2">Error Loading Table</h3>
            <pre className="text-sm whitespace-pre-wrap font-mono">
              {tab.error}
            </pre>
          </div>
        ) : hasData ? (
          <DataViewer
            tableName={tableName}
            schema={schema}
            connectionId={tab.connectionId}
            onRowClick={() => {}}
            initialViewMode={tab.payload.initialViewMode}
            preloadedData={{
              data: tableData.data?.rows || [],
              columns: tableData.data?.columns.map(c => c.name) || [],
              totalRows: tableData.data?.total_rows,
            }}
          />
        ) : isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">Loading table data...</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <p className="text-muted-foreground">No data found</p>
              <Button onClick={handleRefresh} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}