import { Plus, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useHomeScreenStore } from '../../store/homeScreenStore';

export function ActionBarActions() {
  const actionBarExpanded = useHomeScreenStore((s) => s.actionBarExpanded);
  const openConnectionForm = useHomeScreenStore((s) => s.openConnectionForm);

  const handleNewConnection = () => {
    openConnectionForm('create');
  };

  const handleNewERD = () => {
    // TODO: Implement ERD workspace creation
    console.log('Create ERD workspace');
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'justify-start gap-2 h-8',
              !actionBarExpanded && 'px-2'
            )}
            onClick={handleNewConnection}
          >
            <Plus className="h-3.5 w-3.5" />
            {actionBarExpanded && (
              <span className="text-xs">New Connection</span>
            )}
          </Button>
        </TooltipTrigger>
        {!actionBarExpanded && (
          <TooltipContent side="right" className="text-xs">
            New Connection
          </TooltipContent>
        )}
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'justify-start gap-2 h-8',
              !actionBarExpanded && 'px-2'
            )}
            onClick={handleNewERD}
          >
            <GitBranch className="h-3.5 w-3.5" />
            {actionBarExpanded && (
              <span className="text-xs">ERD Workspace</span>
            )}
          </Button>
        </TooltipTrigger>
        {!actionBarExpanded && (
          <TooltipContent side="right" className="text-xs">
            ERD Workspace
          </TooltipContent>
        )}
      </Tooltip>
    </div>
  );
}
