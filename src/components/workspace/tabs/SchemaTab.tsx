import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useDatabase } from '@/hooks/useDatabase';
import { type TabState } from '@/types/workspace';
import {
  RefreshCw,
  Search,
  Table,
  Eye,
  FileText,
  Database,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
} from 'lucide-react';

interface SchemaTabProps {
  tab: TabState;
}

interface SchemaItem {
  type: 'table' | 'view' | 'function' | 'procedure';
  name: string;
  schema: string;
  comment?: string;
  columns?: number;
  rows?: number;
}

export function SchemaTab({ tab }: SchemaTabProps) {
  const { addTab } = useWorkspaceStore();
  const workspace = useWorkspaceStore(s => s.getActiveWorkspace());
  
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set(['public']));

  // Data fetching
  const databasesQuery = useDatabase(tab.connectionId);
  

  const schemaItems = useMemo(() => {
    if (!databasesQuery.data?.tables && !databasesQuery.data?.views) return [];
    
    const items: SchemaItem[] = [];
    
    // Add tables
    if (databasesQuery.data.tables) {
      items.push(...databasesQuery.data.tables.map(table => ({
        type: 'table' as const,
        name: table.name,
        schema: table.schema || 'public',
        comment: undefined,
        columns: undefined,
        rows: table.rowCount,
      })));
    }
    
    // Add views
    if (databasesQuery.data.views) {
      items.push(...databasesQuery.data.views.map(view => ({
        type: 'view' as const,
        name: view.name,
        schema: view.schema || 'public',
        comment: undefined,
      })));
    }
    
    // Add functions/procedures
    if (databasesQuery.data.functions) {
      items.push(...databasesQuery.data.functions.map(func => ({
        type: 'function' as const,
        name: func.name,
        schema: func.schema || 'public',
        comment: undefined,
      })));
    }
    
    return items;
  }, [databasesQuery.data]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return schemaItems;
    
    const query = searchQuery.toLowerCase();
    return schemaItems.filter(item => 
      item.name.toLowerCase().includes(query) ||
      item.schema.toLowerCase().includes(query) ||
      item.comment?.toLowerCase().includes(query)
    );
  }, [schemaItems, searchQuery]);

  const groupedItems = useMemo(() => {
    const groups: Record<string, SchemaItem[]> = {};
    
    filteredItems.forEach(item => {
      const schema = item.schema || 'public';
      if (!groups[schema]) {
        groups[schema] = [];
      }
      groups[schema].push(item);
    });
    
    // Sort items within each schema
    Object.keys(groups).forEach(schema => {
      groups[schema]!.sort((a, b) => {
        // Sort by type, then by name
        if (a.type !== b.type) {
          const typeOrder = { table: 0, view: 1, function: 2, procedure: 3 };
          return typeOrder[a.type] - typeOrder[b.type];
        }
        return a.name.localeCompare(b.name);
      });
    });
    
    return groups;
  }, [filteredItems]);

  const handleRefresh = useCallback(() => {
    databasesQuery.refetch();
  }, [databasesQuery]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleToggleSchema = useCallback((schema: string) => {
    setExpandedSchemas(prev => {
      const newSet = new Set(prev);
      if (newSet.has(schema)) {
        newSet.delete(schema);
      } else {
        newSet.add(schema);
      }
      return newSet;
    });
  }, []);

  const handleOpenTable = useCallback((schema: string, tableName: string, type: 'table' | 'view') => {
    if (!workspace?.id) return;
    
    addTab(workspace.id, {
      type: 'table',
      title: `${schema}.${tableName}`,
      connectionId: tab.connectionId,
      payload: {
        schema,
        tableName,
        tableType: type,
      },
    });
  }, [addTab, workspace, tab.connectionId]);

  const handleOpenQuery = useCallback((schema: string, name: string, type: 'function' | 'procedure') => {
    if (!workspace?.id) return;
    
    const sql = type === 'function' 
      ? `SELECT * FROM ${schema}.${name}();`
      : `CALL ${schema}.${name}();`;
    
    addTab(workspace.id, {
      type: 'query',
      title: `${schema}.${name}`,
      connectionId: tab.connectionId,
      payload: {
        sql,
        schema,
        objectName: name,
        objectType: type,
      },
    });
  }, [addTab, workspace, tab.connectionId]);

  const getItemIcon = (type: string) => {
    switch (type) {
      case 'table':
        return <Table className="h-4 w-4" />;
      case 'view':
        return <Eye className="h-4 w-4" />;
      case 'function':
        return <FileText className="h-4 w-4" />;
      case 'procedure':
        return <FileText className="h-4 w-4" />;
      default:
        return <Database className="h-4 w-4" />;
    }
  };

  const getItemBadgeVariant = (type: string) => {
    switch (type) {
      case 'table':
        return 'default';
      case 'view':
        return 'secondary';
      case 'function':
        return 'outline';
      case 'procedure':
        return 'outline';
      default:
        return 'outline';
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4" />
          <span className="font-medium">Schema Browser</span>
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search schema objects..."
            value={searchQuery}
            onChange={(e) => { handleSearch(e.target.value); }}
            className="pl-8"
          />
        </div>

        <Button
          onClick={handleRefresh}
          disabled={databasesQuery.isLoading}
          size="sm"
          variant="outline"
        >
          <RefreshCw className={`h-4 w-4 ${databasesQuery.isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Schema Tree */}
      <div className="flex-1 overflow-auto p-2">
        {tab.error ? (
          <div className="p-4 bg-destructive/10 text-destructive">
            <h3 className="font-medium mb-2">Error Loading Schema</h3>
            <pre className="text-sm whitespace-pre-wrap font-mono">
              {tab.error}
            </pre>
          </div>
        ) : databasesQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">Loading schema...</p>
            </div>
          </div>
        ) : Object.keys(groupedItems).length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-center space-y-2">
              <p className="text-muted-foreground">No schema objects found</p>
              {searchQuery && (
                <Button 
                  onClick={() => { setSearchQuery(''); }} 
                  variant="outline" 
                  size="sm"
                >
                  Clear search
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {Object.entries(groupedItems).map(([schema, items]) => {
              const isExpanded = expandedSchemas.has(schema);
              
              return (
                <div key={schema} className="space-y-1">
                  {/* Schema Header */}
                  <div
                    className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer group"
                    onClick={() => { handleToggleSchema(schema); }}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronDown className="h-4 w-4" />
                        <FolderOpen className="h-4 w-4 text-blue-500" />
                      </>
                    ) : (
                      <>
                        <ChevronRight className="h-4 w-4" />
                        <Folder className="h-4 w-4 text-blue-500" />
                      </>
                    )}
                    <span className="font-medium">{schema}</span>
                    <Badge variant="outline" className="ml-auto">
                      {items.length}
                    </Badge>
                  </div>

                  {/* Schema Items */}
                  {isExpanded && (
                    <div className="ml-6 space-y-1">
                      {items.map((item) => (
                        <div
                          key={`${item.schema}.${item.name}`}
                          className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer group"
                          onClick={() => {
                            if (item.type === 'table' || item.type === 'view') {
                              handleOpenTable(item.schema, item.name, item.type);
                            } else {
                              handleOpenQuery(item.schema, item.name, item.type);
                            }
                          }}
                        >
                          {getItemIcon(item.type)}
                          <span className="flex-1">{item.name}</span>
                          
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Badge variant={getItemBadgeVariant(item.type)} className="text-xs">
                              {item.type}
                            </Badge>
                            
                            {item.type === 'table' && item.columns && (
                              <Badge variant="outline" className="text-xs">
                                {item.columns} cols
                              </Badge>
                            )}
                            
                            {item.type === 'table' && typeof item.rows === 'number' && (
                              <Badge variant="outline" className="text-xs">
                                {item.rows.toLocaleString()} rows
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}