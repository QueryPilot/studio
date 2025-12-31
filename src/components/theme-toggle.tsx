import { IconMoon, IconSun } from '@tabler/icons-react';
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/appStore";

export function ThemeToggle() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => { setTheme(theme === "light" ? "dark" : "light"); }}
    >
      <IconSun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <IconMoon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
