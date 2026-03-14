import { memo } from 'react';
import {
  IconKey,
  IconHash,
  IconList,
  IconTags,
  IconChartArrowsVertical,
  IconClock,
  IconDatabase,
  IconRefresh,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import type { KeyMetadata } from '../sources/types';
import type { RedisType } from '@/adapters/types/redis';

interface KeyHeaderProps {
  metadata: KeyMetadata | null;
  onRefresh?: () => void;
  className?: string;
}

const TypeIcon = memo(function TypeIcon({ type }: { type: RedisType }) {
  const icons: Record<RedisType, React.ReactNode> = {
    string: <IconKey className="h-4 w-4" />,
    hash: <IconHash className="h-4 w-4" />,
    list: <IconList className="h-4 w-4" />,
    set: <IconTags className="h-4 w-4" />,
    zset: <IconChartArrowsVertical className="h-4 w-4" />,
    stream: <IconDatabase className="h-4 w-4" />,
    unknown: <IconKey className="h-4 w-4" />,
  };

  return icons[type] ?? icons.string;
});

const TypeBadge = memo(function TypeBadge({ type }: { type: RedisType }) {
  const colors = {
    string: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
    hash: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    list: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20',
    set: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20',
    zset: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20',
    stream: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
    unknown: 'bg-muted text-muted-foreground border-border',
  };

  const colorClass = colors[type] ?? colors.unknown;
  const displayType = type.toUpperCase();

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-xs font-medium tracking-wider',
        colorClass
      )}
    >
      {displayType}
    </span>
  );
});

const TTLDisplay = memo(function TTLDisplay({ ttl }: { ttl: number }) {
  if (ttl < 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <IconClock className="h-3 w-3" />
        <span>No expiry</span>
      </span>
    );
  }

  const formatTTL = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    if (seconds < 3600) {
      return `${Math.floor(seconds / 60)}m`;
    }
    if (seconds < 86400) {
      return `${Math.floor(seconds / 3600)}h`;
    }
    return `${Math.floor(seconds / 86400)}d`;
  };

  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <IconClock className="h-3 w-3" />
      <span>{formatTTL(ttl)}</span>
    </span>
  );
});

export const KeyHeader = memo(function KeyHeader({
  metadata,
  onRefresh,
  className,
}: KeyHeaderProps) {
  if (!metadata) {
    return null;
  }

  const { key, type, ttl, size } = metadata;

  return (
    <div
      className={cn(
        'flex items-center gap-4 border-b border-border bg-muted/30 px-4 py-3',
        className
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <TypeIcon type={type} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-base font-semibold truncate max-w-[300px]" title={key}>
                {key}
              </h2>
              <TypeBadge type={type} />
            </div>
            <div className="flex items-center gap-4 mt-0.5">
              <TTLDisplay ttl={ttl} />
              {size !== undefined && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="font-mono">{size.toLocaleString()}</span>
                  <span>bytes</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className={cn(
            'px-3 py-2 rounded-md',
            'hover:bg-accent transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-ring',
            'text-foreground'
          )}
          aria-label="Refresh key data"
        >
          <IconRefresh className="h-4 w-4" />
        </button>
      )}
    </div>
  );
});
