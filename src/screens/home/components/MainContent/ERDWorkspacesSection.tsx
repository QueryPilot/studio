import { logger } from "@/lib/logger";
import { IconSitemap, IconPlus } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';

export function ERDWorkspacesSection() {
  // TODO: Load ERD workspaces from store

  const handleCreateWorkspace = () => {
    // TODO: Implement ERD workspace creation
    logger.info('Create ERD workspace');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <IconSitemap className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-xs font-medium text-muted-foreground">
            ERD Workspaces
          </h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={handleCreateWorkspace}
        >
          <IconPlus className="h-3 w-3 mr-1" />
          New
        </Button>
      </div>

      <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-lg">
        No ERD workspaces yet.
        <br />
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs text-amber-500"
          onClick={handleCreateWorkspace}
        >
          Create your first workspace
        </Button>
      </div>
    </div>
  );
}
