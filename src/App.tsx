import { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { MainScreen } from "./screens/main/MainScreen";
import { WorkspaceScreen } from "./screens/workspace/WorkspaceScreen";
import { initializeGlobalScrollbar } from "./components/CustomScrollbar";
import "overlayscrollbars/overlayscrollbars.css";
import "./styles/overlayscrollbars.css";

function App() {
  useEffect(() => {
    // Initialize OverlayScrollbars on body
    initializeGlobalScrollbar();
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainScreen />} />
        <Route path="/workspace/:connectionId" element={<WorkspaceScreen />} />
      </Routes>
    </Router>
  );
}

export default App;
