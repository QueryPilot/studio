import { IconSettings, IconMoon, IconSun } from '@tabler/icons-react';
import { useTheme } from '@/components/theme-provider';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { cn } from '@/lib/utils';

export function ActionBarFooter() {
  const { theme, setTheme } = useTheme();
  const { openPreferences } = usePreferencesStore();

  const handleToggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const buttonClass = cn(
    'flex items-center gap-2 w-full px-3 py-2 rounded-md',
    'text-xs text-muted-foreground',
    'hover:text-foreground hover:bg-sidebar-accent',
    'transition-colors duration-150'
  );

  return (
    <div className="flex flex-col gap-0.5 p-2 border-t border-sidebar-border">
      <button type="button" className={buttonClass} onClick={() => openPreferences()}>
        <IconSettings className="h-4 w-4" />
        <span>Settings</span>
      </button>

      <button type="button" className={buttonClass} onClick={handleToggleTheme}>
        {theme === 'dark' ? (
          <IconSun className="h-4 w-4" />
        ) : (
          <IconMoon className="h-4 w-4" />
        )}
        <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
      </button>
    </div>
  );
}
