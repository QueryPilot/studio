import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { MainScreen } from "./screens/main/MainScreen";
import { WorkspaceScreen } from "./screens/workspace/WorkspaceScreen";
import { KeyboardProvider, useShortcut } from "./services/keyboard";
import { useEffect } from "react";
import { setupStoreIntegration } from "./services/keyboard/integration/storeIntegration";
import { windowManager } from "./services/windowManager";
import {
  ensureOpencodeConfigs,
  ensureOpencodeServer,
} from "./services/opencodeService";
import { PreferencesDialog } from "./components/Preferences/PreferencesDialog";
import { usePreferencesStore } from "./stores/preferencesStore";

function AppContent() {
  const openPreferences = usePreferencesStore((state) => state.open);

  // Register global keyboard shortcut for new window
  useShortcut(
    "cmd+shift+n",
    async () => {
      await windowManager.openNewMainWindow();
    },
    {
      preventDefault: true,
      description: "Open new window",
    },
  );

  // Register global keyboard shortcut for preferences
  useShortcut(
    "cmd+,",
    () => {
      openPreferences();
    },
    {
      preventDefault: true,
      description: "Open preferences",
    },
  );

  return (
    <>
      <Router>
        <Routes>
          <Route path="/" element={<MainScreen />} />
          <Route path="/workspace/:connectionId" element={<WorkspaceScreen />} />
        </Routes>
      </Router>
      <PreferencesDialog />
    </>
  );
}

function App() {
  useEffect(() => {
    // Setup store integration for keyboard context
    const cleanup = setupStoreIntegration();
    void (async () => {
      try {
        await ensureOpencodeConfigs();
        await ensureOpencodeServer();
      } catch (err) {
        console.warn("[AI] Failed to prepare OpenCode server", err);
      }
    })();
    return cleanup;
  }, []);

  return (
    <KeyboardProvider>
      <AppContent />
    </KeyboardProvider>
  );
}

export default App;
