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
    <div className="flex flex-col gap-0.5 px-1.5 py-1">
      {ENV_FILTERS.map((env) => {
        const isActive =
          env.key === 'all'
            ? activeEnvFilters.includes('all')
            : activeEnvFilters.includes(env.key);

        return (
          <button
            key={env.key}
            type="button"
            className={cn(
              'group flex items-center gap-2.5 h-8 px-2.5 w-full rounded-lg text-left',
              'transition-all duration-150 ease-out',
              'text-muted-foreground hover:text-foreground',
              'hover:bg-foreground/[0.06]',
              isActive && 'bg-foreground/[0.08] text-foreground'
            )}
            onClick={() => toggleEnvFilter(env.key)}
          >
            <div
              className={cn(
                'h-2 w-2 rounded-full flex-shrink-0 transition-all duration-150',
                env.color,
                'group-hover:scale-110',
                isActive && 'scale-125'
              )}
            />
            <span className={cn(
              'text-[13px] transition-all duration-150',
              isActive && 'font-medium'
            )}>
              {env.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
