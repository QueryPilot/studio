import { logger } from '@/lib/logger';
import { IconPlus, IconSitemap } from '@tabler/icons-react';
import { useHomeScreenStore } from '../../store/homeScreenStore';

export function ActionBarActions() {
  const openConnectionForm = useHomeScreenStore((s) => s.openConnectionForm);

  const handleNewConnection = () => {
    openConnectionForm('create');
  };

  const handleNewERD = () => {
    // TODO: Implement ERD workspace creation
    logger.info('Create ERD workspace');
  };

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <button
        type="button"
        onClick={handleNewConnection}
        className="flex items-center gap-3 p-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors text-left"
      >
        <div className="flex items-center justify-center h-7 w-7 rounded-md bg-primary/20">
          <IconPlus className="h-4 w-4 text-primary" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium">New Connection</span>
          <span className="text-[10px] text-muted-foreground">
            Add database
          </span>
        </div>
      </button>

      <button
        type="button"
        onClick={handleNewERD}
        className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-sidebar-accent transition-colors text-left"
      >
        <div className="flex items-center justify-center h-7 w-7 rounded-md bg-muted">
          <IconSitemap className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium">ERD Workspace</span>
          <span className="text-[10px] text-muted-foreground">
            Entity diagrams
          </span>
        </div>
      </button>
    </div>
  );
}
