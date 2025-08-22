import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  Database,
  FileText,
  Play,
  Table,
} from 'lucide-react';

interface EmptyStateProps {
  message?: string;
}

export function EmptyState({ message = "No tab selected" }: EmptyStateProps) {
  const { getActiveWorkspace, addTab } = useWorkspaceStore();
  const workspace = getActiveWorkspace();

  const handleCreateTab = (type: 'query' | 'table' | 'schema') => {
    if (!workspace?.activeConnectionId) {
      console.warn('No active connection available for new tab');
      return;
    }

    const title = {
      query: 'New Query',
      table: 'Table Browser',
      schema: 'Schema Browser',
    }[type];

    if (workspace) {
      addTab(workspace.id, {
        type,
        title,
        connectionId: workspace.activeConnectionId,
        payload: {},
      });
    }
  };

  return (
    <div className="flex items-center justify-center h-full bg-background">
      <div className="text-center space-y-6 p-8 max-w-md">
        <div className="w-16 h-16 mx-auto rounded-full bg-muted flex items-center justify-center">
          <FileText className="w-8 h-8 text-muted-foreground" />
        </div>
        
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-foreground">
            {message}
          </h3>
          <p className="text-sm text-muted-foreground">
            Create a new tab to get started with your database exploration.
          </p>
        </div>

        {workspace?.activeConnectionId && (
          <div className="flex flex-col gap-2 w-full">
            <Button
              onClick={() => { handleCreateTab('query'); }}
              className="w-full justify-start"
              variant="outline"
            >
              <Play className="h-4 w-4 mr-2" />
              New SQL Query
            </Button>
            
            <Button
              onClick={() => { handleCreateTab('table'); }}
              className="w-full justify-start"
              variant="outline"
            >
              <Table className="h-4 w-4 mr-2" />
              Browse Tables
            </Button>
            
            <Button
              onClick={() => { handleCreateTab('schema'); }}
              className="w-full justify-start"
              variant="outline"
            >
              <Database className="h-4 w-4 mr-2" />
              Browse Schema
            </Button>
          </div>
        )}

        {!workspace?.activeConnectionId && (
          <p className="text-sm text-muted-foreground italic">
            Connect to a database to create tabs
          </p>
        )}
      </div>
    </div>
  );
}