import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider 
      attribute="class" 
      defaultTheme="system" 
      enableSystem
      storageKey="devdb-theme"
    >
      <App />
      <Toaster position="bottom-right" richColors />
    </ThemeProvider>
  </React.StrictMode>,
);
