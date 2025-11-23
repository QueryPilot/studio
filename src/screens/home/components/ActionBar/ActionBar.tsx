import { ActionBarLogo } from './ActionBarLogo';
import { ActionBarActions } from './ActionBarActions';
import { EnvFilter } from './EnvFilter';
import { ActionBarFooter } from './ActionBarFooter';

export function ActionBar() {
  return (
    <div className="h-full flex flex-col bg-secondary">
      {/* Logo */}
      <ActionBarLogo />

      {/* Actions */}
      <ActionBarActions />

      {/* Environment Filters */}
      <EnvFilter />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Footer */}
      <ActionBarFooter />
    </div>
  );
}
