import { IconSettings, IconMoon, IconSun } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import { usePreferencesStore } from '@/stores/preferencesStore';

export function ActionBarFooter() {
  const { theme, setTheme } = useTheme();
  const { openPreferences } = usePreferencesStore();

  const handleToggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2 h-8"
        onClick={() => openPreferences()}
      >
        <IconSettings className="h-3.5 w-3.5" />
        <span className="text-xs">Settings</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2 h-8"
        onClick={handleToggleTheme}
      >
        {theme === 'dark' ? (
          <IconSun className="h-3.5 w-3.5" />
        ) : (
          <IconMoon className="h-3.5 w-3.5" />
        )}
        <span className="text-xs">
          {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        </span>
      </Button>
    </div>
  );
}
