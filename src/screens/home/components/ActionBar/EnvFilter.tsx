import { Button } from '@/components/ui/button';
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
          <Button
            key={env.key}
            variant="ghost"
            size="sm"
            className={cn(
              'justify-start gap-2 h-7',
              isActive && 'bg-accent'
            )}
            onClick={() => toggleEnvFilter(env.key)}
          >
            <div
              className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', env.color)}
            />
            <span className="text-xs">{env.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
