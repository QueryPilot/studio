import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";

// Suppress external script errors in development
if (process.env.NODE_ENV === "development") {
  window.addEventListener("error", (e) => {
    if (e.filename && e.filename.includes("user-script")) {
      e.preventDefault();
      return true;
    }
  });

  window.addEventListener("unhandledrejection", (e) => {
    if (e.reason && e.reason.stack && e.reason.stack.includes("user-script")) {
      e.preventDefault();
      return true;
    }
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="devdb-theme"
    >
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
