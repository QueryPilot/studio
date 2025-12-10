import { useCallback, useEffect, useRef, useState } from 'react';

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

  // Use ref to avoid stale closure in event handlers
  const isModifierHeldRef = useRef(isModifierHeld);
  isModifierHeldRef.current = isModifierHeld;

  // Stable ref for contextService to avoid effect re-runs
  const contextServiceRef = useRef(contextService);
  contextServiceRef.current = contextService;

  const updateModifierState = useCallback((held: boolean) => {
    if (isModifierHeldRef.current !== held) {
      isModifierHeldRef.current = held;
      setIsModifierHeld(held);
      contextServiceRef.current?.setValue('modifierKeyHeld', held);
    }
  }, []);

  useEffect(() => {
    const platform = detectPlatform();
    const isMetaKey = platform === 'mac';

    const handleKeyDown = (event: KeyboardEvent) => {
      const modifierPressed = isMetaKey ? event.metaKey : event.ctrlKey;
      if (modifierPressed) {
        updateModifierState(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const modifierPressed = isMetaKey ? event.metaKey : event.ctrlKey;
      if (!modifierPressed) {
        updateModifierState(false);
      }
    };

    const handleBlur = () => {
      updateModifierState(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);

      // Reset context on unmount
      if (isModifierHeldRef.current) {
        contextServiceRef.current?.setValue('modifierKeyHeld', false);
      }
    };
  }, [updateModifierState]);

  return isModifierHeld;
}
