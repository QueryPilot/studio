import { cn } from '@/lib/utils';
import { useHomeScreenStore } from '../../store/homeScreenStore';

export function ActionBarLogo() {
  const actionBarExpanded = useHomeScreenStore((s) => s.actionBarExpanded);
  const setContentMode = useHomeScreenStore((s) => s.setContentMode);

  const handleClick = () => {
    setContentMode('browse');
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 p-2 cursor-pointer hover:bg-accent/50 transition-colors',
        !actionBarExpanded && 'justify-center'
      )}
      onClick={handleClick}
    >
      <img
        src="/logo.png"
        alt="Query Pilot"
        className="h-8 w-8 rounded-lg"
      />
      {actionBarExpanded && (
        <span className="text-xs font-semibold truncate">Query Pilot</span>
      )}
    </div>
  );
}
