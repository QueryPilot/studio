import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { MainScreen } from "./screens/main/MainScreen";
import { WorkspaceScreen } from "./screens/workspace/WorkspaceScreen";
import { useSecureStorageMigration } from "./hooks/useSecureStorageMigration";
import { navigationTransition } from "./services/navigationTransition";
import { useEffect } from "react";

function App() {
  // Handle migration from localStorage to secure storage
  const { isReady, migrationStatus, error } = useSecureStorageMigration();
  
  useEffect(() => {
    if (migrationStatus === 'completed') {
      console.log('✅ Secure storage is ready');
      // Add fade-in effect after navigation
      navigationTransition.fadeIn();
    }
    if (error) {
      console.error('❌ Migration error:', error);
    }
  }, [migrationStatus, error]);
  
  // Show loading screen during migration
  if (!isReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">
            {migrationStatus === 'migrating' ? 'Securing your data...' : 'Initializing secure storage...'}
          </p>
          {error && (
            <p className="text-destructive mt-2 text-sm">Error: {error}</p>
          )}
        </div>
      </div>
    );
  }
  
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainScreen />} />
        <Route path="/workspace/:id" element={<WorkspaceScreen />} />
      </Routes>
    </Router>
  );
}

export default App;