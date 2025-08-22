import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { SortableTab } from "./SortableTab";
import { NewTabButton } from "./NewTabButton";

export function TabBar() {
  const workspace = useWorkspaceStore((s) => s.getActiveWorkspace());
  const { setActiveTab, closeTab, reorderTabs } = useWorkspaceStore();

  // Setup drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  if (!workspace) {
    return null;
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = workspace.tabOrder.indexOf(active.id as string);
      const newIndex = workspace.tabOrder.indexOf(over?.id as string);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(workspace.tabOrder, oldIndex, newIndex);
        reorderTabs(workspace.id, newOrder);
      }
    }
  };

  return (
    <div className="flex items-center border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={workspace.tabOrder}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex items-center min-w-0 flex-1">
            {workspace.tabOrder.map((tabId) => {
              const tab = workspace.tabs.get(tabId);
              if (!tab) return null;

              // Only show tabs that belong to the active connection
              if (
                !workspace.activeConnectionId ||
                tab.connectionId !== workspace.activeConnectionId
              ) {
                return null;
              }

              const isActive = workspace.activeTabId === tabId;

              return (
                <SortableTab
                  key={tab.id}
                  tab={tab}
                  isActive={isActive}
                  onActivate={() => { setActiveTab(workspace.id, tab.id); }}
                  onClose={() => { closeTab(workspace.id, tab.id); }}
                />
              );
            })}

            <NewTabButton workspaceId={workspace.id} />
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
