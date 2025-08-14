import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { WorkspaceTitleBar } from "./components/WorkspaceTitleBar";
import { DatabaseSidebar } from "./components/DatabaseSidebar";
import { EditorPanel } from "./components/EditorPanel";
import { StatusBar } from "./components/StatusBar";
import { useState, useRef, useEffect } from "react";
import { ImperativePanelHandle } from "react-resizable-panels";
import { Settings } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { useConnectionStore } from "@/stores";

export function WorkspaceScreen() {
  const { id: _workspaceId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const priorityConnectionId = searchParams.get('connection');
  const { connections, setActiveConnection, connect } = useConnectionStore();
  
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);
  
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);
  
  const toggleLeftPanel = () => {
    if (leftPanelVisible) {
      leftPanelRef.current?.collapse();
    } else {
      leftPanelRef.current?.expand(20); // Set to 20% when expanding
    }
    setLeftPanelVisible(!leftPanelVisible);
  };
  
  const toggleRightPanel = () => {
    if (rightPanelVisible) {
      rightPanelRef.current?.collapse();
    } else {
      rightPanelRef.current?.expand(30); // Set to 30% when expanding
    }
    setRightPanelVisible(!rightPanelVisible);
  };
  
  // Handle priority connection on workspace open
  useEffect(() => {
    if (priorityConnectionId && connections.has(priorityConnectionId)) {
      // Set as active connection
      setActiveConnection(priorityConnectionId);
      // Auto-connect if not already connected
      const connection = connections.get(priorityConnectionId);
      if (connection && connection.status !== 'connected' && connection.status !== 'connecting') {
        console.log(`[WorkspaceScreen] Auto-connecting to ${priorityConnectionId}`);
        connect(priorityConnectionId).catch(err => {
          console.error(`[WorkspaceScreen] Failed to auto-connect:`, err);
        });
      }
    }
  }, [priorityConnectionId, connections, setActiveConnection, connect]);

  // Prevent Cmd+A from selecting all text in the entire app
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Check if Cmd+A (Mac) or Ctrl+A (Windows/Linux) is pressed
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        // Check if the active element is an input, textarea, or contenteditable
        const activeElement = document.activeElement;
        const isEditableElement = 
          activeElement?.tagName === 'INPUT' ||
          activeElement?.tagName === 'TEXTAREA' ||
          activeElement?.getAttribute('contenteditable') === 'true' ||
          activeElement?.classList.contains('monaco-editor');
        
        // If not in an editable element, prevent default
        if (!isEditableElement) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    // Add event listener with capture to intercept early
    document.addEventListener('keydown', handleKeyDown, true);

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);
  
  return (
    <div className="workspace-screen h-screen flex flex-col overflow-hidden bg-background">
      <WorkspaceTitleBar
        onToggleLeftPanel={toggleLeftPanel}
        onToggleRightPanel={toggleRightPanel}
        leftPanelVisible={leftPanelVisible}
        rightPanelVisible={rightPanelVisible}
      />

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel
            ref={leftPanelRef}
            defaultSize={20}
            minSize={15}
            maxSize={30}
            collapsible={true}
            collapsedSize={0}
            onCollapse={() => setLeftPanelVisible(false)}
            onExpand={() => setLeftPanelVisible(true)}
          >
            <DatabaseSidebar />
          </ResizablePanel>

          {leftPanelVisible && <ResizableHandle />}

          <ResizablePanel defaultSize={50} minSize={30}>
            <EditorPanel />
          </ResizablePanel>

          {rightPanelVisible && <ResizableHandle />}

          <ResizablePanel
            ref={rightPanelRef}
            defaultSize={0}
            minSize={20}
            maxSize={50}
            collapsible={true}
            collapsedSize={0}
            onCollapse={() => setRightPanelVisible(false)}
            onExpand={() => setRightPanelVisible(true)}
          >
            <div className="h-full bg-muted/30 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Settings className="h-8 w-8 mx-auto mb-2" />
                <p className="text-sm">Right Panel</p>
                <p className="text-xs">Additional tools</p>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <StatusBar />
    </div>
  );
}
