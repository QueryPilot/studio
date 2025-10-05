# Keyboard System V2: Deep Scan & Fix Plan

## Executive Summary

**Current Status**: ❌ Keyboard chord sequences (e.g., `cmd+k left`) are **NOT working**

**Root Causes Identified**:
1. ✅ Chord parsing exists in `KeyNormalizer` but NOT implemented in `KeyboardManager`
2. ❌ `cmd+k` conflicts: Command Palette vs Navigation Chords
3. ❌ No timeout/state machine for chord sequences
4. ❌ Missing Tauri global-shortcut plugin integration

---

## 🔍 Deep Scan Results

### Issue #1: Chord Sequences Not Implemented

**Location**: `src/services/keyboard/KeyboardManager.ts:80-124`

**Problem**: The `handleKeyDown` method only matches single key combinations:
```typescript
// Line 87: Gets normalized key
const normalized = this.normalizer.normalize(event);

// Line 91: Looks up commands by single key
const commands = this.registry.getByKeybinding(normalized);
```

**Evidence**:
- `KeyNormalizer.parse()` returns `{ sequence?: string[] }` for chords (line 104-111)
- `KeyNormalizer.normalize()` does NOT handle sequences - only single keys
- No state tracking for multi-key sequences

**Impact**: All chord shortcuts in `WorkbenchLayout.tsx` (lines 369-411) are **BROKEN**:
- ❌ `cmd+k left` - Navigate left panel
- ❌ `cmd+k right` - Navigate right panel
- ❌ `cmd+k up` - Navigate up panel
- ❌ `cmd+k down` - Navigate down panel

### Issue #2: cmd+k Conflict

**Conflict Details**:

1. **Command Palette** (`useCommandPalette.ts:20-31`)
   ```typescript
   keybinding: {
     key: 'cmd+k',  // ⚠️ Fires immediately
     when: ''
   }
   ```

2. **Default Keybindings** (`keybindings.json:140`)
   ```json
   {
     "command": "view.commandPalette",
     "key": "cmd+k",  // ⚠️ Same key!
     "description": "Open command palette"
   }
   ```

3. **Navigation Chords** (`WorkbenchLayout.tsx:369`)
   ```typescript
   useShortcut("cmd+k left", ...)  // ⚠️ Never reached!
   ```

**Result**: Pressing `cmd+k` opens Command Palette instead of waiting for next key.

### Issue #3: No Chord State Machine

**Missing Components**:
- ❌ Pending chord state tracking
- ❌ Timeout for chord completion (~1000ms industry standard)
- ❌ Visual feedback for chord prefix (e.g., "cmd+k" indicator)
- ❌ Chord cancellation on Escape or timeout

**Reference Implementation** (VS Code-like):
```typescript
interface ChordState {
  prefix: string | null;        // "cmd+k"
  timestamp: number;             // When prefix was pressed
  timeout: number;               // 1000ms default
}
```

### Issue #4: No Global Shortcuts

**Current State**:
- ❌ Tauri global-shortcut plugin NOT installed
- ❌ No system-wide shortcuts (app in background)
- ❌ No global hotkey to show/hide app

**Tauri V2 Plugin**: `tauri-plugin-global-shortcut`
- ✅ Available: https://v2.tauri.app/plugin/global-shortcut/
- ✅ Supports macOS, Windows, Linux
- ❌ Not in `Cargo.toml`

---

## 🎯 Solution Architecture

### Phase 1: Fix Chord Sequences (High Priority)

#### 1.1 Implement Chord State Machine

**File**: `src/services/keyboard/ChordManager.ts` (NEW)

```typescript
export class ChordManager {
  private chordState: {
    prefix: string | null;
    timestamp: number;
    timeoutId: NodeJS.Timeout | null;
  } = {
    prefix: null,
    timestamp: 0,
    timeoutId: null,
  };

  private readonly CHORD_TIMEOUT = 1000; // 1 second

  startChord(prefix: string): void {
    // Clear existing timeout
    if (this.chordState.timeoutId) {
      clearTimeout(this.chordState.timeoutId);
    }

    this.chordState.prefix = prefix;
    this.chordState.timestamp = Date.now();

    // Set timeout to clear chord state
    this.chordState.timeoutId = setTimeout(() => {
      this.clearChord();
    }, this.CHORD_TIMEOUT);
  }

  completeChord(suffix: string): string | null {
    if (!this.chordState.prefix) return null;

    const chord = `${this.chordState.prefix} ${suffix}`;
    this.clearChord();
    return chord;
  }

  clearChord(): void {
    if (this.chordState.timeoutId) {
      clearTimeout(this.chordState.timeoutId);
    }
    this.chordState.prefix = null;
    this.chordState.timestamp = 0;
    this.chordState.timeoutId = null;
  }

  getPrefix(): string | null {
    return this.chordState.prefix;
  }

  isWaitingForChord(): boolean {
    return this.chordState.prefix !== null;
  }
}
```

#### 1.2 Update KeyboardManager

**File**: `src/services/keyboard/KeyboardManager.ts`

**Changes**:
```typescript
export class KeyboardManager {
  private chordManager: ChordManager; // NEW

  private handleKeyDown = (event: KeyboardEvent): void => {
    const normalized = this.normalizer.normalize(event);
    if (!normalized) return;

    // Check if we're waiting for second key in chord
    if (this.chordManager.isWaitingForChord()) {
      const prefix = this.chordManager.getPrefix()!;
      const chordKey = `${prefix} ${normalized}`;

      // Try to find chord command
      const chordCommands = this.registry.getByKeybinding(chordKey);

      if (chordCommands.length > 0) {
        // Execute chord command
        this.chordManager.clearChord();
        const command = this.resolveConflict(chordCommands);
        if (command) {
          event.preventDefault();
          event.stopPropagation();
          void this.executeCommand(command.id);
        }
        return;
      } else {
        // No chord match, clear state
        this.chordManager.clearChord();
      }
    }

    // Check if this key starts a chord sequence
    const chordPrefixCommands = this.findChordPrefixes(normalized);

    if (chordPrefixCommands.length > 0) {
      // Start chord sequence
      event.preventDefault();
      this.chordManager.startChord(normalized);
      this.showChordIndicator(normalized); // Visual feedback
      return;
    }

    // Regular single-key command handling
    const commands = this.registry.getByKeybinding(normalized);
    // ... existing logic
  };

  private findChordPrefixes(prefix: string): Command[] {
    const allCommands = this.registry.getAll();
    return allCommands.filter(cmd => {
      const key = cmd.keybinding?.key;
      return key?.startsWith(`${prefix} `);
    });
  }

  private showChordIndicator(prefix: string): void {
    // Dispatch event for UI to show indicator
    window.dispatchEvent(new CustomEvent('keyboard:chord-started', {
      detail: { prefix }
    }));
  }
}
```

#### 1.3 Visual Chord Indicator

**File**: `src/components/ChordIndicator.tsx` (NEW)

```typescript
export function ChordIndicator() {
  const [prefix, setPrefix] = useState<string | null>(null);

  useEffect(() => {
    const handleChordStart = (e: CustomEvent) => {
      setPrefix(e.detail.prefix);
    };

    const handleChordEnd = () => {
      setPrefix(null);
    };

    window.addEventListener('keyboard:chord-started', handleChordStart);
    window.addEventListener('keyboard:chord-cleared', handleChordEnd);

    return () => {
      window.removeEventListener('keyboard:chord-started', handleChordStart);
      window.removeEventListener('keyboard:chord-cleared', handleChordEnd);
    };
  }, []);

  if (!prefix) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-accent text-accent-foreground px-3 py-2 rounded-md shadow-lg animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center gap-2">
        <Keyboard className="w-4 h-4" />
        <span className="text-sm font-mono">{prefix}</span>
        <span className="text-xs text-muted-foreground">waiting...</span>
      </div>
    </div>
  );
}
```

### Phase 2: Fix cmd+k Conflict

#### Option A: Change Command Palette Shortcut (Recommended)

**Benefits**:
- ✅ Follows VS Code convention (Cmd+Shift+P for commands)
- ✅ Frees up cmd+k for navigation chords
- ✅ No breaking changes to chord logic

**Changes**:

1. **Update Command Palette** (`useCommandPalette.ts`)
   ```typescript
   manager.registerCommand({
     id: 'workbench.action.showCommands',
     title: 'Show All Commands',
     handler: () => setState({ isOpen: true, mode: '>' }),
     keybinding: {
       key: 'cmd+shift+p',  // ✅ Changed from cmd+k
       when: ''
     }
   });
   ```

2. **Update keybindings.json**
   ```json
   {
     "command": "view.commandPalette",
     "key": "cmd+shift+p",  // ✅ Changed
     "description": "Open command palette"
   }
   ```

3. **Keep cmd+p for Quick Open** (already exists in `useCommandPalette.ts:40`)

#### Option B: Make cmd+k Intelligent (Advanced)

**Logic**:
- If chord commands exist for `cmd+k [x]`: Wait for next key
- If timeout occurs: Open Command Palette as fallback

**Pros**: More flexible
**Cons**: More complex, potential confusion

### Phase 3: Tauri Global Shortcuts Integration

#### 3.1 Install Plugin

**File**: `src-tauri/Cargo.toml`

```toml
[dependencies]
# ... existing dependencies
tauri-plugin-global-shortcut = "2"  # ✅ ADD
```

#### 3.2 Register Plugin

**File**: `src-tauri/src/lib.rs` (or `main.rs`)

```rust
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Register global shortcut to show app
            let shortcut = Shortcut::new(Some(Modifiers::SUPER), Code::KeySpace)?;

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, shortcut| {
                        // Show main window
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    })
                    .build(),
            )?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 3.3 Frontend Integration

**File**: `src/services/keyboard/globalShortcuts.ts` (NEW)

```typescript
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

export class GlobalShortcutManager {
  async registerGlobalShortcut(
    shortcut: string,
    handler: () => void
  ): Promise<void> {
    try {
      await register(shortcut, handler);
      console.log(`Registered global shortcut: ${shortcut}`);
    } catch (error) {
      console.error(`Failed to register global shortcut ${shortcut}:`, error);
    }
  }

  async unregisterGlobalShortcut(shortcut: string): Promise<void> {
    try {
      await unregister(shortcut);
    } catch (error) {
      console.error(`Failed to unregister global shortcut ${shortcut}:`, error);
    }
  }

  async registerShowHideShortcut(handler: () => void): Promise<void> {
    // Platform-specific global shortcuts
    const shortcuts = {
      mac: 'Command+Shift+Space',
      windows: 'Control+Shift+Space',
      linux: 'Control+Shift+Space'
    };

    const platform = await import('@tauri-apps/api/os').then(os => os.platform());
    const shortcut = shortcuts[platform] || shortcuts.windows;

    await this.registerGlobalShortcut(shortcut, handler);
  }
}
```

---

## 📋 Implementation Checklist

### Phase 1: Fix Chord Sequences ⏰ 1-2 days

- [ ] **Day 1**:
  - [ ] Create `ChordManager.ts` with state machine
  - [ ] Add unit tests for ChordManager
  - [ ] Update `KeyboardManager.handleKeyDown()` with chord logic
  - [ ] Add `findChordPrefixes()` method

- [ ] **Day 2**:
  - [ ] Create `ChordIndicator.tsx` component
  - [ ] Add to `App.tsx` or `WorkspaceScreen.tsx`
  - [ ] Test chord shortcuts manually
  - [ ] Add E2E test for `cmd+k left/right/up/down`

### Phase 2: Fix cmd+k Conflict ⏰ 0.5 day

- [ ] **Decision**: Choose Option A (Change to cmd+shift+p)
- [ ] Update `useCommandPalette.ts` keybinding
- [ ] Update `keybindings.json` default
- [ ] Update documentation/tooltips
- [ ] Test Command Palette with new shortcut

### Phase 3: Global Shortcuts ⏰ 1 day

- [ ] Add `tauri-plugin-global-shortcut` to `Cargo.toml`
- [ ] Create Tauri setup with global shortcut registration
- [ ] Create `GlobalShortcutManager.ts`
- [ ] Add preferences UI for custom global shortcut
- [ ] Test on macOS, Windows, Linux

### Phase 4: Testing & Documentation ⏰ 0.5 day

- [ ] Write unit tests for ChordManager
- [ ] Write integration tests for chord sequences
- [ ] Update keyboard shortcuts documentation
- [ ] Add keyboard shortcuts help modal
- [ ] Test all shortcuts end-to-end

---

## 🔬 Testing Strategy

### Unit Tests

**File**: `src/services/keyboard/__tests__/ChordManager.test.ts`

```typescript
describe('ChordManager', () => {
  let manager: ChordManager;

  beforeEach(() => {
    manager = new ChordManager();
    jest.useFakeTimers();
  });

  test('starts chord sequence', () => {
    manager.startChord('cmd+k');
    expect(manager.getPrefix()).toBe('cmd+k');
    expect(manager.isWaitingForChord()).toBe(true);
  });

  test('completes chord sequence', () => {
    manager.startChord('cmd+k');
    const result = manager.completeChord('left');
    expect(result).toBe('cmd+k left');
    expect(manager.isWaitingForChord()).toBe(false);
  });

  test('times out after 1 second', () => {
    manager.startChord('cmd+k');
    jest.advanceTimersByTime(1000);
    expect(manager.isWaitingForChord()).toBe(false);
  });

  test('clears chord on escape', () => {
    manager.startChord('cmd+k');
    manager.clearChord();
    expect(manager.getPrefix()).toBeNull();
  });
});
```

### Integration Tests

**File**: `src/services/keyboard/__tests__/KeyboardManager.chord.test.ts`

```typescript
describe('KeyboardManager - Chord Sequences', () => {
  test('executes chord command', async () => {
    const handler = jest.fn();

    manager.registerCommand({
      id: 'test.chordCommand',
      title: 'Test Chord',
      handler,
      keybinding: { key: 'cmd+k left' }
    });

    // Simulate cmd+k
    fireKeyEvent({ key: 'k', metaKey: true });
    expect(handler).not.toHaveBeenCalled();

    // Simulate left arrow
    fireKeyEvent({ key: 'ArrowLeft' });
    expect(handler).toHaveBeenCalled();
  });

  test('timeout clears chord state', () => {
    const handler = jest.fn();

    manager.registerCommand({
      id: 'test.chord',
      handler,
      keybinding: { key: 'cmd+k left' }
    });

    fireKeyEvent({ key: 'k', metaKey: true });
    jest.advanceTimersByTime(1000);

    fireKeyEvent({ key: 'ArrowLeft' });
    expect(handler).not.toHaveBeenCalled();
  });
});
```

### E2E Tests

**File**: `e2e/keyboard-shortcuts.spec.ts` (Playwright)

```typescript
test('chord sequences work in workbench', async ({ page }) => {
  await page.goto('/workspace/conn-123');

  // Split panel right with cmd+\
  await page.keyboard.press('Meta+\\');
  await expect(page.locator('[data-panel-id]')).toHaveCount(2);

  // Navigate right with cmd+k right
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(100); // Brief pause for chord
  await page.keyboard.press('ArrowRight');

  // Verify focus moved
  const focusedPanel = page.locator('[data-panel-focused="true"]');
  await expect(focusedPanel).toHaveAttribute('data-panel-position', 'right');
});

test('command palette opens with cmd+shift+p', async ({ page }) => {
  await page.goto('/workspace/conn-123');

  await page.keyboard.press('Meta+Shift+p');
  await expect(page.locator('[data-command-palette]')).toBeVisible();
});
```

---

## 🚀 Migration Guide

### For Users

**Breaking Changes**:
- ⚠️ Command Palette shortcut changed: `cmd+k` → `cmd+shift+p`
- ✅ New chord shortcuts now work: `cmd+k [arrow]` for panel navigation

**New Features**:
- ✨ Global shortcut to show app (configurable)
- ✨ Visual chord indicator when waiting for second key
- ✨ Consistent keyboard experience across all panels

### For Developers

**API Changes**:

```typescript
// OLD: Chord shortcuts didn't work
useShortcut('cmd+k left', handler);  // ❌ Broken

// NEW: Chord shortcuts work correctly
useShortcut('cmd+k left', handler);  // ✅ Fixed

// NEW: Visual feedback for chords
<ChordIndicator />  // Add to root component
```

**Best Practices**:

1. **Use chords for related actions**:
   ```typescript
   // Good: Navigation family
   useShortcut('cmd+k left', navigateLeft);
   useShortcut('cmd+k right', navigateRight);
   useShortcut('cmd+k up', navigateUp);
   useShortcut('cmd+k down', navigateDown);
   ```

2. **Avoid chord conflicts**:
   ```typescript
   // Bad: Conflicts with chord prefix
   useShortcut('cmd+k', openSomething);  // ❌
   useShortcut('cmd+k left', navigate);  // ❌ Never reached!

   // Good: Different prefixes
   useShortcut('cmd+shift+k', openSomething);  // ✅
   useShortcut('cmd+k left', navigate);        // ✅ Works!
   ```

3. **Provide fallbacks**:
   ```typescript
   // Always provide non-chord alternative for important actions
   useShortcut('cmd+k left', navigateLeft);   // Chord
   useShortcut('alt+left', navigateLeft);     // Fallback
   ```

---

## 📊 Success Metrics

- ✅ All 4 navigation chord shortcuts working (`cmd+k [arrow]`)
- ✅ Zero conflicts between Command Palette and chords
- ✅ Chord timeout working correctly (1 second)
- ✅ Visual feedback shown for chord prefixes
- ✅ Global shortcuts registered successfully
- ✅ 100% test coverage for chord logic
- ✅ Documentation updated with new shortcuts

---

## 🔗 References

1. **VS Code Keyboard Implementation**:
   - Chord sequences: https://github.com/microsoft/vscode/blob/main/src/vs/platform/keybinding/common/keybinding.ts
   - Keybinding service: https://github.com/microsoft/vscode/blob/main/src/vs/platform/keybinding/common/keybindingResolver.ts

2. **Tauri Global Shortcuts**:
   - Plugin docs: https://v2.tauri.app/plugin/global-shortcut/
   - API reference: https://docs.rs/tauri-plugin-global-shortcut/latest/

3. **Current Implementation**:
   - KeyboardManager: `src/services/keyboard/KeyboardManager.ts`
   - KeyNormalizer: `src/services/keyboard/KeyNormalizer.ts`
   - CommandRegistry: `src/services/keyboard/CommandRegistry.ts`

---

## 🎯 Recommended Timeline

**Total Effort**: 3-4 days

| Phase | Duration | Priority | Dependencies |
|-------|----------|----------|--------------|
| Phase 1: Chord Sequences | 1-2 days | 🔴 Critical | None |
| Phase 2: cmd+k Conflict | 0.5 day | 🔴 Critical | Phase 1 |
| Phase 3: Global Shortcuts | 1 day | 🟡 Medium | None |
| Phase 4: Testing/Docs | 0.5 day | 🟢 Low | All phases |

**Quick Win**: Fix Phase 1 & 2 first (1.5-2.5 days) to unblock navigation shortcuts immediately.

---

## 💡 Additional Recommendations

### 1. Keyboard Shortcuts Cheat Sheet

Create an in-app keyboard shortcuts modal:

```typescript
// src/components/KeyboardShortcutsHelp.tsx
export function KeyboardShortcutsHelp() {
  const shortcuts = useAllKeybindings();

  return (
    <Dialog>
      <DialogContent className="max-w-4xl">
        <ShortcutTable shortcuts={shortcuts} groupBy="category" />
      </DialogContent>
    </Dialog>
  );
}

// Register shortcut
useCommand({
  id: 'help.keyboardShortcuts',
  title: 'Keyboard Shortcuts Reference',
  handler: () => openShortcutsHelp(),
  keybinding: { key: 'f1' }
});
```

### 2. Customizable Shortcuts UI

Add to Preferences:

```typescript
// src/components/Preferences/panels/KeyboardShortcutsPanel.tsx
export function KeyboardShortcutsPanel() {
  const { shortcuts, updateShortcut } = useKeyboardSettings();

  return (
    <div>
      <SearchInput placeholder="Search shortcuts..." />
      <ShortcutsList
        shortcuts={shortcuts}
        onEdit={(id, newKey) => updateShortcut(id, newKey)}
        showConflicts
      />
    </div>
  );
}
```

### 3. Performance Optimization

Cache chord prefix lookups:

```typescript
class KeyboardManager {
  private chordPrefixCache = new Map<string, boolean>();

  private isChordPrefix(key: string): boolean {
    if (this.chordPrefixCache.has(key)) {
      return this.chordPrefixCache.get(key)!;
    }

    const hasChords = this.findChordPrefixes(key).length > 0;
    this.chordPrefixCache.set(key, hasChords);
    return hasChords;
  }

  // Clear cache when commands change
  registerCommand(cmd: Command): () => void {
    this.chordPrefixCache.clear();
    return super.registerCommand(cmd);
  }
}
```

---

## 🎬 Next Steps

1. **Review this plan** with the team
2. **Decide on cmd+k approach** (Option A or B)
3. **Start Phase 1** implementation
4. **Test thoroughly** on all platforms
5. **Update documentation** and help resources

**Questions to Answer**:
- [ ] Should cmd+k be Command Palette or navigation chord prefix?
- [ ] What global shortcut key combo? (Cmd+Shift+Space?)
- [ ] Do we need configurable chord timeout?
- [ ] Should we show chord hints in tooltips?
