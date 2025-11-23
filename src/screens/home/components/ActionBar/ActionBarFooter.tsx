import { IconSettings, IconMoon, IconSun } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';

export function ActionBarFooter() {
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
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2 h-8"
        onClick={handleOpenSettings}
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
