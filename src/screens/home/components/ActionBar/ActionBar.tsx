import { ActionBarLogo } from "./ActionBarLogo";
import { ActionBarActions } from "./ActionBarActions";
import { SidebarFavorites } from "./SidebarFavorites";
import { EnvFilter } from "./EnvFilter";
import { ActionBarFooter } from "./ActionBarFooter";

export function ActionBar() {
  return (
    <div className="h-full flex flex-col bg-transparent">
      {/* Logo */}
      <ActionBarLogo />

      {/* Actions */}
      <ActionBarActions />

      {/* Quick Access */}
      <div className="flex-1 overflow-y-auto scrollbar-none contain-[paint]">
        {/* Favorites */}
        <SidebarFavorites />

        {/* Environment Filters */}
        <div className="px-2 py-1">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Environment
          </div>
          <EnvFilter />
        </div>
      </div>

      {/* Footer */}
      <ActionBarFooter />
    </div>
  );
}
