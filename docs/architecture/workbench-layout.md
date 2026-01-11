# VS Code-Style Workbench Layout Specification

## Executive Summary

This document outlines the implementation strategy for transforming our workspace panel layout to match VS Code's sophisticated workbench architecture. The implementation will support up to 4 horizontal panels and 2 vertical panels with dynamic splitting, resizing, and drag-and-drop capabilities.

## 1. VS Code Architecture Analysis

### 1.1 Core Concepts

VS Code's workbench uses a **binary tree-based layout system** where:
- Each node is either a **leaf** (containing a panel) or a **branch** (containing a split)
- Splits can be horizontal or vertical
- Each split maintains a ratio between its children
- The tree structure allows infinite nesting theoretically, but VS Code limits this for UX

### 1.2 Key Components

```
┌─────────────────────────────────────────────────────┐
│                    Workbench                         │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐          ┌──────────────┐        │
│  │  GridWidget  │ ────────> │  EditorGroup │        │
│  └──────────────┘          └──────────────┘        │
│         │                          │                │
│         ▼                          ▼                │
│  ┌──────────────┐          ┌──────────────┐        │
│  │   GridNode   │          │    Panel     │        │
│  └──────────────┘          └──────────────┘        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 1.3 VS Code's Grid System

VS Code implements a sophisticated grid system with:
- **GridWidget**: Root component managing the entire layout
- **GridBranchNode**: Represents a split (horizontal/vertical)
- **GridLeafNode**: Contains actual content (editor/panel)
- **Sizing Distributor**: Handles size constraints and distribution

## 2. Implementation Architecture

### 2.1 Data Structure

```typescript
type Orientation = 'horizontal' | 'vertical';

interface GridNode {
  id: string;
  type: 'branch' | 'leaf';
  orientation?: Orientation;  // Only for branch nodes
  splitRatio?: number;         // 0-1, percentage of first child
  children?: GridNode[];       // Only for branch nodes
  content?: PanelContent;      // Only for leaf nodes
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
}

interface PanelContent {
  type: 'editor' | 'terminal' | 'output' | 'problems' | 'custom';
  tabIds: string[];
  activeTabId: string;
  metadata?: Record<string, any>;
}
```

### 2.2 Layout Tree Example

```
                 Root (branch, horizontal)
                        /            \
                   0.6 /              \ 0.4
                      /                \
            Panel A (leaf)      Split B (branch, vertical)
                                     /          \
                                0.5 /            \ 0.5
                                   /              \
                          Panel B1 (leaf)    Panel B2 (leaf)
```

### 2.3 Component Hierarchy

```typescript
// Root component
<WorkbenchLayout>
  <PanelGridProvider>
    <GridContainer>
      <GridNode node={rootNode} />
    </GridContainer>
    <DragOverlay />
  </PanelGridProvider>
</WorkbenchLayout>

// Recursive grid rendering
function GridNode({ node, path = [] }) {
  if (node.type === 'leaf') {
    return <Panel content={node.content} path={path} />;
  }
  
  return (
    <SplitContainer orientation={node.orientation}>
      <GridNode node={node.children[0]} path={[...path, 0]} />
      <SplitHandle 
        onDrag={handleResize} 
        orientation={node.orientation} 
      />
      <GridNode node={node.children[1]} path={[...path, 1]} />
    </SplitContainer>
  );
}
```

## 3. Core Features Implementation

### 3.1 Panel Splitting

```typescript
interface SplitAction {
  targetPanelId: string;
  direction: 'up' | 'down' | 'left' | 'right';
  newPanelContent?: PanelContent;
  splitRatio?: number;  // Default 0.5
}

function splitPanel(tree: GridNode, action: SplitAction): GridNode {
  // Find target panel
  const path = findNodePath(tree, action.targetPanelId);
  if (!path) throw new Error('Panel not found');
  
  // Create new branch node
  const orientation = ['up', 'down'].includes(action.direction) 
    ? 'vertical' 
    : 'horizontal';
  
  const newPanel: GridNode = {
    id: generateId(),
    type: 'leaf',
    content: action.newPanelContent || createDefaultContent()
  };
  
  const targetPanel = getNodeByPath(tree, path);
  const newBranch: GridNode = {
    id: generateId(),
    type: 'branch',
    orientation,
    splitRatio: action.splitRatio || 0.5,
    children: action.direction === 'right' || action.direction === 'down'
      ? [targetPanel, newPanel]
      : [newPanel, targetPanel]
  };
  
  return updateNodeAtPath(tree, path, newBranch);
}
```

### 3.2 Panel Closing

```typescript
function closePanel(tree: GridNode, panelId: string): GridNode | null {
  const path = findNodePath(tree, panelId);
  if (!path || path.length === 0) return null;
  
  // If it's the root and only panel, return null
  if (path.length === 0) return null;
  
  // Get parent and sibling
  const parentPath = path.slice(0, -1);
  const parent = getNodeByPath(tree, parentPath);
  const siblingIndex = path[path.length - 1] === 0 ? 1 : 0;
  const sibling = parent.children[siblingIndex];
  
  // Replace parent with sibling
  if (parentPath.length === 0) {
    return sibling;  // New root
  } else {
    return updateNodeAtPath(tree, parentPath, sibling);
  }
}
```

### 3.3 Resize Handling

```typescript
interface ResizeHandler {
  startResize(path: number[], initialRatio: number): void;
  updateResize(delta: number): void;
  endResize(): void;
}

const useResizeHandler = (): ResizeHandler => {
  const [resizing, setResizing] = useState<{
    path: number[];
    initialRatio: number;
    startPosition: number;
  } | null>(null);
  
  return {
    startResize(path, initialRatio) {
      setResizing({ path, initialRatio, startPosition: 0 });
    },
    
    updateResize(delta) {
      if (!resizing) return;
      
      const newRatio = calculateNewRatio(
        resizing.initialRatio,
        delta,
        getConstraints(resizing.path)
      );
      
      updateTreeRatio(resizing.path, newRatio);
    },
    
    endResize() {
      setResizing(null);
      persistLayout();
    }
  };
};
```

### 3.4 Drag and Drop

```typescript
interface DragDropContext {
  draggedTab: Tab | null;
  draggedPanel: string | null;
  dropTarget: DropTarget | null;
  dropPosition: 'center' | 'top' | 'bottom' | 'left' | 'right';
}

function handleDrop(context: DragDropContext) {
  const { draggedTab, dropTarget, dropPosition } = context;
  
  if (dropPosition === 'center') {
    // Move tab to target panel
    moveTabToPanel(draggedTab, dropTarget.panelId);
  } else {
    // Create new split
    const direction = positionToDirection(dropPosition);
    splitPanel(tree, {
      targetPanelId: dropTarget.panelId,
      direction,
      newPanelContent: {
        type: 'editor',
        tabIds: [draggedTab.id],
        activeTabId: draggedTab.id
      }
    });
  }
}
```

## 4. State Management

### 4.1 Zustand Store

```typescript
interface WorkbenchStore {
  // State
  layoutTree: GridNode | null;
  focusedPanelId: string | null;
  panelContents: Map<string, PanelContent>;
  layoutHistory: GridNode[];
  
  // Actions
  initializeLayout: () => void;
  splitPanel: (action: SplitAction) => void;
  closePanel: (panelId: string) => void;
  resizePanel: (path: number[], ratio: number) => void;
  moveTab: (tabId: string, targetPanelId: string) => void;
  focusPanel: (panelId: string) => void;
  
  // Persistence
  saveLayout: () => void;
  restoreLayout: () => void;
  resetLayout: () => void;
  
  // History
  undo: () => void;
  redo: () => void;
}

const useWorkbenchStore = create<WorkbenchStore>()(
  persist(
    (set, get) => ({
      layoutTree: null,
      focusedPanelId: null,
      panelContents: new Map(),
      layoutHistory: [],
      
      splitPanel: (action) => {
        const tree = get().layoutTree;
        if (!tree) return;
        
        const newTree = splitPanel(tree, action);
        set({
          layoutTree: newTree,
          layoutHistory: [...get().layoutHistory, tree]
        });
      },
      
      // ... other actions
    }),
    {
      name: 'workbench-layout',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        layoutTree: state.layoutTree,
        panelContents: Array.from(state.panelContents.entries())
      })
    }
  )
);
```

## 5. UI Components

### 5.1 WorkbenchLayout

```typescript
const WorkbenchLayout: React.FC = () => {
  const { layoutTree } = useWorkbenchStore();
  const [isDragging, setIsDragging] = useState(false);
  
  return (
    <DndContext 
      onDragStart={() => setIsDragging(true)}
      onDragEnd={handleDragEnd}
    >
      <div className="workbench-container">
        {layoutTree ? (
          <GridRenderer node={layoutTree} />
        ) : (
          <EmptyWorkbench />
        )}
      </div>
      
      <DragOverlay>
        {isDragging && <DragPreview />}
      </DragOverlay>
    </DndContext>
  );
};
```

### 5.2 SplitHandle

```typescript
const SplitHandle: React.FC<{
  orientation: Orientation;
  onResize: (delta: number) => void;
}> = ({ orientation, onResize }) => {
  const [isDragging, setIsDragging] = useState(false);
  
  return (
    <div
      className={cn(
        'split-handle',
        orientation === 'horizontal' ? 'vertical-handle' : 'horizontal-handle',
        isDragging && 'dragging'
      )}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <div className="handle-dots" />
    </div>
  );
};
```

### 5.3 Panel Component

```typescript
const Panel: React.FC<{
  content: PanelContent;
  path: number[];
}> = ({ content, path }) => {
  const { focusedPanelId, focusPanel } = useWorkbenchStore();
  const isFocused = focusedPanelId === content.id;
  
  return (
    <div 
      className={cn('panel', isFocused && 'focused')}
      onClick={() => focusPanel(content.id)}
    >
      <PanelHeader content={content} />
      <PanelBody content={content} />
      <DropZone position="all" panelId={content.id} />
    </div>
  );
};
```

## 6. Keyboard Shortcuts

### 6.1 Implementation

Keyboard handling is now centralised through the `KeyboardProvider`. Panels register the commands they care about and provide context keys that enable/disable bindings. This removes ad‑hoc window listeners and gives us VS Code–style scope evaluation.

```typescript
// src/components/Workbench/PanelDnd.tsx
const focusPanel = useWorkbenchStore((s) => s.focusPanel);
const focusNextPanel = useCallback(() => {
  const ids = Array.from(useWorkbenchStore.getState().panelContents.keys());
  if (ids.length <= 1) return;
  const current = useWorkbenchStore.getState().focusedPanelId ?? ids[0];
  const next = ids[(ids.indexOf(current) + 1) % ids.length];
  focusPanel(next);
}, [focusPanel]);

useCommand(
  "workbench.action.focusNextPanel",
  focusNextPanel,
  {
    label: "Focus Next Panel",
    category: "Workbench",
    when: "hasMultipleEditors",
  },
);
```

Context keys drive when a binding is active:

```typescript
const scopeId = useScopedKeybindings(panelId);
useContextKey("activeEditor", Boolean(focusedPanelId === content.id), {
  scopeId,
  resetOnUnmount: true,
});
```

### 6.2 Default Shortcut Map

The command registry seeds the following workbench commands and keybindings:

| Command | macOS / Windows binding | Notes |
| --- | --- | --- |
| `workbench.action.splitPanelRight` | `⌘\` / `Ctrl+\` | Split the active panel to the right |
| `workbench.action.splitPanelDown` | `⌘⇧\` / `Ctrl+Shift+\` | Split the active panel below |
| `workbench.action.splitPanelLeft` | `⌘⌥←` / `Ctrl+Alt+Left` | Split to the left (no new tab) |
| `workbench.action.splitPanelUp` | `⌘⌥↑` / `Ctrl+Alt+Up` | Split above |
| `workbench.action.focusNextPanel` | `⌘]` / `Ctrl+]` | Cycle panel focus forward |
| `workbench.action.focusPreviousPanel` | `⌘[` / `Ctrl+[` | Cycle panel focus backward |
| `workbench.action.newQueryTab` | `⌘T` / `Ctrl+T` | Create a query tab in the focused panel |
| `workbench.action.closeActiveTab` | `⌘W` / `Ctrl+W` | Closes the panel when >1 panels exist, otherwise closes the tab |

Additional data‑grid commands (`Cmd+C`, `Cmd+Shift+C`, `Cmd+V`, `Cmd+Enter`, etc.) are registered through the same provider so grid menus display accurate shortcuts.

## 7. Constraints and Limits

### 7.1 Panel Limits

```typescript
export const CONSTRAINTS: WorkbenchConstraints = {
  MAX_COLUMNS: 5,
  MAX_ROWS: 2,
  MIN_PANEL_WIDTH: 200,
  MIN_PANEL_HEIGHT: 150,
  MIN_SPLIT_RATIO: 0.1,
  MAX_SPLIT_RATIO: 0.9,
};

export function canSplitPanel(
  tree: GridNode,
  targetPanelId: string,
  direction: Direction,
): boolean {
  const orientation = ["left", "right"].includes(direction)
    ? "horizontal"
    : "vertical";

  if (orientation === "horizontal") {
    return countHorizontalPanelsInRow(tree, targetPanelId) < CONSTRAINTS.MAX_COLUMNS;
  }

  return countVerticalPanelsInColumn(tree, targetPanelId) < CONSTRAINTS.MAX_ROWS;
}
```

## 8. Implementation Phases

### Phase 1: Core Grid System (Foundation)
- Implement GridNode data structure
- Create tree manipulation utilities
- Build basic rendering system
- Set up Zustand store

### Phase 2: Panel Operations
- Implement split functionality
- Add panel closing
- Create resize handlers
- Add focus management

### Phase 3: Interactive Features
- Implement drag-and-drop
- Add keyboard shortcuts
- Create visual feedback
- Build drop zones

### Phase 4: Polish and Persistence
- Add animations
- Implement layout persistence
- Create layout presets
- Add undo/redo support

## 9. Migration Strategy

### 9.1 Current System Analysis
```typescript
// Current: Simple tab-based system
interface CurrentWorkspace {
  tabs: Tab[];
  activeTabId: string;
}

// New: Tree-based panel system
interface NewWorkspace {
  layoutTree: GridNode;
  panelContents: Map<string, PanelContent>;
}
```

### 9.2 Migration Function
```typescript
function migrateWorkspace(current: CurrentWorkspace): NewWorkspace {
  // Create single panel with all tabs
  const rootPanel: GridNode = {
    id: 'migrated-root',
    type: 'leaf',
    content: {
      type: 'editor',
      tabIds: current.tabs.map(t => t.id),
      activeTabId: current.activeTabId
    }
  };
  
  return {
    layoutTree: rootPanel,
    panelContents: new Map([['migrated-root', rootPanel.content]])
  };
}
```

### 9.3 Feature Flag Rollout
```typescript
const FEATURE_FLAGS = {
  USE_NEW_WORKBENCH: process.env.NODE_ENV === 'development',
  ENABLE_DRAG_DROP: true,
  ENABLE_KEYBOARD_SHORTCUTS: true,
  PERSIST_LAYOUT: false  // Enable after testing
};
```

## 10. Testing Strategy

### 10.1 Unit Tests
```typescript
describe('GridNode Operations', () => {
  test('should split panel horizontally', () => {
    const tree = createLeafNode('panel-1');
    const result = splitPanel(tree, {
      targetPanelId: 'panel-1',
      direction: 'right'
    });
    
    expect(result.type).toBe('branch');
    expect(result.orientation).toBe('horizontal');
    expect(result.children).toHaveLength(2);
  });
  
  test('should respect max panel constraints', () => {
    const tree = createMaxHorizontalTree();
    const canSplit = canSplitPanel(tree, 'horizontal');
    expect(canSplit).toBe(false);
  });
});
```

### 10.2 Integration Tests
```typescript
describe('Workbench Integration', () => {
  test('should persist layout to localStorage', async () => {
    const { result } = renderHook(() => useWorkbenchStore());
    
    act(() => {
      result.current.splitPanel({
        targetPanelId: 'root',
        direction: 'right'
      });
    });
    
    const stored = localStorage.getItem('workbench-layout');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored).layoutTree).toMatchObject({
      type: 'branch',
      orientation: 'horizontal'
    });
  });
});
```

## 11. Performance Considerations

### 11.1 Optimization Strategies
- Use React.memo for panel components
- Implement virtual scrolling for tab lists
- Debounce resize events
- Use CSS transforms for drag preview
- Lazy load panel content

### 11.2 Performance Metrics
```typescript
const PERFORMANCE_TARGETS = {
  SPLIT_OPERATION: 50,    // ms
  RESIZE_FRAME: 16,       // ms (60fps)
  DRAG_FEEDBACK: 100,     // ms
  LAYOUT_RESTORE: 200,    // ms
  TAB_SWITCH: 50          // ms
};
```

## 12. Accessibility

### 12.1 Keyboard Navigation
- Full keyboard support for all operations
- Focus trap within panels
- Announce panel changes to screen readers
- High contrast mode support

### 12.2 ARIA Attributes
```typescript
<div
  role="group"
  aria-label="Workspace panels"
  aria-orientation={orientation}
>
  <div
    role="separator"
    aria-orientation={orientation}
    aria-valuenow={splitRatio * 100}
    aria-valuemin={10}
    aria-valuemax={90}
    tabIndex={0}
  />
</div>
```

## 13. Future Enhancements

### 13.1 Advanced Features
- Floating panels
- Panel maximization
- Layout templates
- Panel grouping
- Custom panel types
- Multi-monitor support

### 13.2 VS Code Feature Parity
- Editor groups
- Side-by-side diff view
- Terminal multiplexing
- Output channels
- Debug console integration

## Appendix A: VS Code References

### Source Code References
- GridWidget: `src/vs/base/browser/ui/grid/gridview.ts`
- EditorGroupView: `src/vs/workbench/browser/parts/editor/editorGroupView.ts`
- SplitView: `src/vs/base/browser/ui/splitview/splitview.ts`
- Layout Service: `src/vs/workbench/services/layout/browser/layoutService.ts`

### Key Algorithms
- Size distribution: `distributeViewSizes()`
- Tree traversal: `doTraverseGrid()`
- Serialization: `serializeGrid()`
- Focus navigation: `focusNextGroup()`

## Appendix B: API Reference

### Core Types
```typescript
export interface IWorkbenchLayoutService {
  readonly onDidLayout: Event<void>;
  readonly onDidChangeActivePanel: Event<string>;
  
  splitPanel(panelId: string, direction: Direction): void;
  closePanel(panelId: string): void;
  focusPanel(panelId: string): void;
  movePanel(panelId: string, targetId: string): void;
  resizePanel(panelId: string, size: number): void;
  
  getLayout(): GridNode;
  setLayout(layout: GridNode): void;
  resetLayout(): void;
}
```

### Event System
```typescript
export interface WorkbenchEvents {
  'panel:split': { panelId: string; direction: Direction };
  'panel:close': { panelId: string };
  'panel:focus': { panelId: string };
  'panel:resize': { panelId: string; size: number };
  'tab:move': { tabId: string; sourcePanelId: string; targetPanelId: string };
  'layout:change': { layout: GridNode };
  'layout:restore': { layout: GridNode };
}
```

---

*This specification provides a comprehensive blueprint for implementing a VS Code-style workbench layout system. The architecture is designed to be extensible, performant, and maintainable while providing a familiar user experience for developers accustomed to VS Code.*
