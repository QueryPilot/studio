import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  Plus,
  Play,
  Table,
  Database,
} from 'lucide-react';

interface NewTabButtonProps {
  workspaceId: string;
}

export function NewTabButton({ workspaceId }: NewTabButtonProps) {
  const { addTab, getActiveWorkspace } = useWorkspaceStore();
  const workspace = getActiveWorkspace();

  const handleCreateTab = (type: 'query' | 'table' | 'schema') => {
    if (!workspace?.activeConnectionId) {
      // TODO: Show connection selection dialog or error
      console.warn('No active connection available for new tab');
      return;
    }

    const title = {
      query: 'New Query',
      table: 'Table Browser',
      schema: 'Schema Browser',
    }[type];

    addTab(workspaceId, {
      type,
      title,
      connectionId: workspace.activeConnectionId,
      payload: {},
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 shrink-0 ml-1 hover:bg-muted/50 border-none"
        >
          <Plus className="h-4 w-4" />
          <span className="sr-only">New tab</span>
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onClick={() => { handleCreateTab('query'); }}>
          <Play className="h-4 w-4 mr-2" />
          New Query
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={() => { handleCreateTab('table'); }}>
          <Table className="h-4 w-4 mr-2" />
          Browse Tables
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={() => { handleCreateTab('schema'); }}>
          <Database className="h-4 w-4 mr-2" />
          Browse Schema
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}