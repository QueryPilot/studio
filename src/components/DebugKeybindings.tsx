import { useEffect, useState } from 'react';
import { contextService } from '@/services/contextService';
import { keybindingService } from '@/services/keybindingService';
import { commandService } from '@/services/commandService';

/**
 * Temporary debug component to diagnose keyboard shortcut issues
 * Press Cmd+Shift+K to toggle the debug panel
 */
export function DebugKeybindings() {
  const [visible, setVisible] = useState(false);
  const [contextValues, setContextValues] = useState<Map<string, unknown>>(new Map());
  const [lastKeyEvent, setLastKeyEvent] = useState<string>('');

  useEffect(() => {
    // Toggle visibility with Cmd+Shift+K
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.shiftKey && event.key === 'K') {
        event.preventDefault();
        setVisible(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, []);

  useEffect(() => {
    if (!visible) return;

    // Update context values every 100ms
    const interval = setInterval(() => {
      const snapshot = contextService.snapshot();
      setContextValues(new Map(snapshot));
    }, 100);

    // Listen for all keyboard events
    const handleAnyKey = (event: KeyboardEvent) => {
      const modifiers = [];
      if (event.metaKey) modifiers.push('cmd');
      if (event.ctrlKey) modifiers.push('ctrl');
      if (event.altKey) modifiers.push('alt');
      if (event.shiftKey) modifiers.push('shift');

      const keyStr = [...modifiers, event.key].join('+');
      setLastKeyEvent(`${keyStr} (code: ${event.code})`);

      // Check if this would match any keybinding
      const bindings = keybindingService.list();
      const matchingBindings = bindings.filter(b =>
        b.key === keyStr || b.key.includes(event.key)
      );

      if (matchingBindings.length > 0) {
        console.log('[DEBUG] Matching keybindings:', matchingBindings);
        console.log('[DEBUG] Active context:', Object.fromEntries(contextService.snapshot()));
      }
    };

    window.addEventListener('keydown', handleAnyKey, { capture: true });

    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', handleAnyKey, { capture: true });
    };
  }, [visible]);

  if (!visible) return null;

  const relevantKeys = [
    'activeEditor',
    'hasMultipleEditors',
    'editorCount',
    'focusedPanelId',
    'tabGroupFocused',
    'editorTextFocus',
    'queryEditor',
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 10,
        right: 10,
        background: 'rgba(0, 0, 0, 0.9)',
        color: '#0f0',
        padding: '15px',
        borderRadius: '8px',
        fontFamily: 'monospace',
        fontSize: '12px',
        zIndex: 999999,
        maxWidth: '400px',
        maxHeight: '80vh',
        overflow: 'auto',
      }}
    >
      <div style={{ marginBottom: '10px', fontWeight: 'bold', color: '#fff' }}>
        🔍 Keyboard Debug Panel (Cmd+Shift+K to toggle)
      </div>

      <div style={{ marginBottom: '10px', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
        <div style={{ color: '#fff', marginBottom: '5px' }}>Last Key Event:</div>
        <div style={{ color: '#ff0' }}>{lastKeyEvent || 'Press any key...'}</div>
      </div>

      <div style={{ marginBottom: '10px', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
        <div style={{ color: '#fff', marginBottom: '5px' }}>Relevant Context Values:</div>
        {relevantKeys.map(key => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span style={{ color: '#0ff' }}>{key}:</span>
            <span style={{ color: contextValues.get(key) ? '#0f0' : '#f00' }}>
              {String(contextValues.get(key) ?? 'undefined')}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: '10px' }}>
        <div style={{ color: '#fff', marginBottom: '5px' }}>Quick Actions:</div>
        <button
          onClick={() => {
            console.log('[DEBUG] All registered commands:', commandService.list());
            console.log('[DEBUG] All registered keybindings:', keybindingService.list());
            console.log('[DEBUG] Full context snapshot:', Object.fromEntries(contextService.snapshot()));
          }}
          style={{
            background: '#333',
            color: '#fff',
            border: '1px solid #666',
            padding: '5px 10px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
        >
          Log All to Console
        </button>
      </div>

      <div style={{ fontSize: '10px', color: '#666', marginTop: '10px' }}>
        Test shortcuts: Cmd+T (new tab), Cmd+\ (split right)
      </div>
    </div>
  );
}
