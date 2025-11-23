import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useHomeScreenStore } from '../../store/homeScreenStore';

const ENV_FILTERS = [
  { key: 'all', label: 'All', color: 'bg-gray-500' },
  { key: 'local', label: 'Local', color: 'bg-gray-500' },
  { key: 'dev', label: 'Dev', color: 'bg-blue-500' },
  { key: 'staging', label: 'Staging', color: 'bg-yellow-500' },
  { key: 'uat', label: 'UAT', color: 'bg-amber-600' },
  { key: 'prod', label: 'Prod', color: 'bg-red-500' },
  { key: 'test', label: 'Test', color: 'bg-green-500' },
];

export function EnvFilter() {
  const actionBarExpanded = useHomeScreenStore((s) => s.actionBarExpanded);
  const activeEnvFilters = useHomeScreenStore((s) => s.activeEnvFilters);
  const toggleEnvFilter = useHomeScreenStore((s) => s.toggleEnvFilter);

  return (
    <div className="flex flex-col gap-0.5 p-2">
      {ENV_FILTERS.map((env) => {
        const isActive =
          env.key === 'all'
            ? activeEnvFilters.includes('all')
            : activeEnvFilters.includes(env.key);

        return (
          <Tooltip key={env.key}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'gap-2 h-7',
                  actionBarExpanded ? 'justify-start' : 'justify-center px-0',
                  isActive && 'bg-accent'
                )}
                onClick={() => toggleEnvFilter(env.key)}
              >
                <div
                  className={cn('h-2 w-2 rounded-full flex-shrink-0', env.color)}
                />
                {actionBarExpanded && (
                  <span className="text-xs">{env.label}</span>
                )}
              </Button>
            </TooltipTrigger>
            {!actionBarExpanded && (
              <TooltipContent side="right" className="text-xs">
                {env.label}
              </TooltipContent>
            )}
          </Tooltip>
        );
      })}
    </div>
  );
}
