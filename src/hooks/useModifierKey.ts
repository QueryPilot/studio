import { useEffect, useState } from 'react';

import { useKeyboardServicesOptional } from '@/components/KeyboardProvider';
import { detectPlatform } from '@/lib/platform';

/**
 * Hook to track the primary modifier key state (Cmd on macOS, Ctrl on Windows/Linux).
 * Updates the 'modifierKeyHeld' context key and returns the current state.
 *
 * @returns {boolean} True when the primary modifier key is held down
 */
export function useModifierKey(): boolean {
  const [isModifierHeld, setIsModifierHeld] = useState(false);
  const services = useKeyboardServicesOptional();
  const contextService = services?.contextService;

  useEffect(() => {
    const platform = detectPlatform();
    const isMetaKey = platform === 'mac';

    const handleKeyDown = (event: KeyboardEvent) => {
      const modifierPressed = isMetaKey ? event.metaKey : event.ctrlKey;

      if (modifierPressed && !isModifierHeld) {
        setIsModifierHeld(true);
        contextService?.setValue('modifierKeyHeld', true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const modifierPressed = isMetaKey ? event.metaKey : event.ctrlKey;

      // Check if the modifier key was released
      if (!modifierPressed && isModifierHeld) {
        setIsModifierHeld(false);
        contextService?.setValue('modifierKeyHeld', false);
      }
    };

    // Handle blur events - reset modifier state when window loses focus
    const handleBlur = () => {
      if (isModifierHeld) {
        setIsModifierHeld(false);
        contextService?.setValue('modifierKeyHeld', false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);

      // Reset context on unmount
      if (contextService && isModifierHeld) {
        contextService.setValue('modifierKeyHeld', false);
      }
    };
  }, [contextService, isModifierHeld]);

  return isModifierHeld;
}
