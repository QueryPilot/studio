import React from 'react';

interface PanelContentRendererProps {
  tabId: string;
  metadata?: any;
}

import { GlideTableDataGrid } from '@/components/DataGrid/glide/GlideTableDataGrid';
import { TableStructure } from '@/components/DataGrid/TableStructure';
import { TableIndexes } from '@/components/DataGrid/TableIndexes';

export const PanelContentRenderer: React.FC<PanelContentRendererProps> = ({ 
  tabId, 
  metadata 
}) => {
  const [type] = tabId.split('-');
  
  if (type === 'query') {
    return (
      <div className="p-4 h-full">
        <h3 className="text-lg font-semibold mb-2">Query Editor</h3>
        <p className="text-muted-foreground">Query panel placeholder</p>
        {metadata?.query && (
          <pre className="mt-4 p-2 bg-muted rounded text-sm">{metadata.query}</pre>
        )}
      </div>
    );
  }
  
  if (type === 'table' && metadata) {
    const viewType = metadata.viewType || 'data';
    
    if (viewType === 'data') {
      return (
        <GlideTableDataGrid
          connectionId={metadata.connectionId}
          database={metadata.database}
          schema={metadata.schema}
          table={metadata.table}
          className="h-full"
        />
      );
    }
    
    if (viewType === 'structure') {
      return (
        <TableStructure
          connectionId={metadata.connectionId}
          database={metadata.database}
          schema={metadata.schema}
          table={metadata.table}
        />
      );
    }
    
    if (viewType === 'indexes') {
      return (
        <TableIndexes
          connectionId={metadata.connectionId}
          database={metadata.database}
          schema={metadata.schema}
          table={metadata.table}
        />
      );
    }
  }
  
  return (
    <div className="p-4 h-full flex items-center justify-center text-muted-foreground">
      <div className="text-center">
        <p>Select a table from the sidebar</p>
        <p className="text-xs mt-2">or create a new query</p>
      </div>
    </div>
  );
};