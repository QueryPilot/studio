import { Settings, Moon, Sun, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useHomeScreenStore } from '../../store/homeScreenStore';
import { useTheme } from '@/components/theme-provider';

export function ActionBarFooter() {
  const actionBarExpanded = useHomeScreenStore((s) => s.actionBarExpanded);
  const toggleActionBar = useHomeScreenStore((s) => s.toggleActionBar);
  const { theme, setTheme } = useTheme();

  const handleToggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleOpenSettings = () => {
    // TODO: Open settings dialog
    console.log('Open settings');
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
            onClick={handleOpenSettings}
          >
            <Settings className="h-3.5 w-3.5" />
            {actionBarExpanded && <span className="text-xs">Settings</span>}
          </Button>
        </TooltipTrigger>
        {!actionBarExpanded && (
          <TooltipContent side="right" className="text-xs">
            Settings
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
            onClick={handleToggleTheme}
          >
            {theme === 'dark' ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
            {actionBarExpanded && (
              <span className="text-xs">
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        {!actionBarExpanded && (
          <TooltipContent side="right" className="text-xs">
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
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
            onClick={toggleActionBar}
          >
            {actionBarExpanded ? (
              <PanelLeftClose className="h-3.5 w-3.5" />
            ) : (
              <PanelLeft className="h-3.5 w-3.5" />
            )}
            {actionBarExpanded && <span className="text-xs">Collapse</span>}
          </Button>
        </TooltipTrigger>
        {!actionBarExpanded && (
          <TooltipContent side="right" className="text-xs">
            Expand
          </TooltipContent>
        )}
      </Tooltip>
    </div>
  );
}
