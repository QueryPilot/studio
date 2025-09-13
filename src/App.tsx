import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { MainScreen } from "./screens/main/MainScreen";
import { WorkspaceScreen } from "./screens/workspace/WorkspaceScreen";
import { KeyboardProvider, useShortcut } from "./services/keyboard";
import { useEffect } from "react";
import { setupStoreIntegration } from "./services/keyboard/integration/storeIntegration";
import { windowManager } from "./services/windowManager";

function AppContent() {
  // Register global keyboard shortcut for new window
  useShortcut('cmd+shift+n', async () => {
    await windowManager.openNewMainWindow();
  }, {
    preventDefault: true,
    description: 'Open new window'
  });

  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainScreen />} />
        <Route path="/workspace/:connectionId" element={<WorkspaceScreen />} />
      </Routes>
    </Router>
  );
}

function App() {
  useEffect(() => {
    // Setup store integration for keyboard context
    const cleanup = setupStoreIntegration();
    return cleanup;
  }, []);

  return (
    <KeyboardProvider>
      <AppContent />
    </KeyboardProvider>
  );
}

export default App;
