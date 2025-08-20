import { useWorkspaceStore } from '@/stores/workspaceStore';
import { QueryTab } from './tabs/QueryTab';
import { TableTab } from './tabs/TableTab';
import { SchemaTab } from './tabs/SchemaTab';
import { ResultTab } from './tabs/ResultTab';
import { EmptyState } from './EmptyState';

export function TabContent() {
  const tab = useWorkspaceStore(s => s.getActiveTab());

  if (!tab) {
    return <EmptyState />;
  }

  // Render based on tab type
  switch (tab.type) {
    case 'query':
      return <QueryTab tab={tab} />;
    
    case 'table':
      return (
        <TableTab
          tab={tab}
          schema={tab.payload.schema || 'public'}
          tableName={tab.payload.tableName || ''}
        />
      );
    
    case 'schema':
      return <SchemaTab tab={tab} />;
    
    case 'result':
      return (
        <ResultTab
          tab={tab}
          resultId={tab.payload.resultId || ''}
        />
      );
    
    default:
      return <EmptyState message="Unknown tab type" />;
  }
}