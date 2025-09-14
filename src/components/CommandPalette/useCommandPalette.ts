import { useState, useEffect } from 'react';
import { KeyboardManager } from '@/services/keyboard/KeyboardManager';
import { useKeyboardStore } from '@/stores/keyboardStore';
import type { PaletteMode } from './CommandPalette';

interface CommandPaletteState {
  isOpen: boolean;
  mode: PaletteMode;
}

export function useCommandPalette() {
  const [state, setState] = useState<CommandPaletteState>({
    isOpen: false,
    mode: '>'
  });

  useEffect(() => {
    const manager = KeyboardManager.getInstance();

    // Register command palette shortcuts
    manager.registerCommand({
      id: 'workbench.action.showCommands',
      title: 'Show All Commands',
      handler: () => {
        setState({ isOpen: true, mode: '>' });
      },
      keybinding: {
        key: 'cmd+shift+p',
        when: ''
      }
    });

    // Quick open
    manager.registerCommand({
      id: 'workbench.action.quickOpen',
      title: 'Quick Open',
      handler: () => {
        setState({ isOpen: true, mode: '>' });
      },
      keybinding: {
        key: 'cmd+p',
        when: ''
      }
    });

    // Go to symbol
    manager.registerCommand({
      id: 'workbench.action.gotoSymbol',
      title: 'Go to Symbol',
      handler: () => {
        setState({ isOpen: true, mode: '@' });
      },
      keybinding: {
        key: 'cmd+shift+o',
        when: ''
      }
    });

    // Go to line
    manager.registerCommand({
      id: 'workbench.action.gotoLine',
      title: 'Go to Line',
      handler: () => {
        setState({ isOpen: true, mode: ':' });
      },
      keybinding: {
        key: 'cmd+g',
        when: 'editorFocus'
      }
    });

    // Show help
    manager.registerCommand({
      id: 'workbench.action.showHelp',
      title: 'Show Help',
      handler: () => {
        setState({ isOpen: true, mode: '?' });
      },
      keybinding: {
        key: 'f1',
        when: ''
      }
    });
  }, []);

  const open = (mode: PaletteMode = '>') => {
    setState({ isOpen: true, mode });
  };

  const close = () => {
    setState(prev => ({ ...prev, isOpen: false }));
  };

  const toggle = (mode: PaletteMode = '>') => {
    setState(prev => ({
      isOpen: !prev.isOpen,
      mode: prev.isOpen ? prev.mode : mode
    }));
  };

  return {
    isOpen: state.isOpen,
    mode: state.mode,
    open,
    close,
    toggle,
    setOpen: (isOpen: boolean) => { setState(prev => ({ ...prev, isOpen })); }
  };
}