import { useEffect } from 'react';
import { ActionBar } from './components/ActionBar/ActionBar';
import { MainContent } from './components/MainContent/MainContent';
import { useConnectionStore } from '@/stores/connectionStoreNew';

export function HomeScreen() {
  const fetchConnections = useConnectionStore((s) => s.fetchConnections);

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Drag region - top bar */}
      <div data-tauri-drag-region className="h-8 w-full flex-shrink-0" />

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Action Bar */}
        <ActionBar />

        {/* Right Main Content */}
        <div className="flex-1 overflow-hidden" data-tauri-drag-region>
          <MainContent />
        </div>
      </div>
    </div>
  );
}
