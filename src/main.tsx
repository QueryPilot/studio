import ReactDOM from "react-dom/client";
import "./styles/globals.css";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { ThemeSync } from "./components/theme-sync";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/react-query-client";
import { enableMapSet } from "immer";
import { StrictMode } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { KeyboardProvider } from "./components/KeyboardProvider";
import { CommandPalette } from "./components/CommandPalette/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp/KeyboardShortcutsHelp";
import { initializeSentry } from "./utils/sentry";
import { usePreferencesStore } from "./stores/preferencesStore";
import { useTabStateStore } from "./stores/tabStateStore";
import { runSessionMigration } from "@/lib/db/sessionMigration";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
enableMapSet();

// Initialize Sentry for error tracking (only in production, opt-in via preferences)
const telemetryPrefs = usePreferencesStore.getState().telemetry;
initializeSentry(telemetryPrefs, "0.4.0");

// Initialize tab state store (migrates from localStorage to IndexedDB if needed)
void useTabStateStore.getState().initialize();

// Migrate old persistence data (localStorage layouts + old IndexedDB tab states)
// to the new consolidated session database. Fire-and-forget — never blocks startup.
runSessionMigration().catch((error) => {
  console.error("[main] Session migration failed:", error);
});

// Suppress external script errors in development
if (process.env.NODE_ENV === "development") {
  window.addEventListener("error", (e) => {
    if (e.filename && e.filename.includes("user-script")) {
      e.preventDefault();
      return true;
    }
    return false;
  });

  window.addEventListener("unhandledrejection", (e) => {
    if (e.reason && e.reason.stack && e.reason.stack.includes("user-script")) {
      e.preventDefault();
      return true;
    }
    return false;
  });
}

// Disable native context menu in production
if (process.env.NODE_ENV === "production") {
  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            storageKey="query-pilot-theme"
          >
            <ThemeSync />
            <TooltipProvider delay={300}>
              <App />
              <Toaster richColors closeButton position="bottom-left" />
              <CommandPalette />
              <KeyboardShortcutsHelp />
            </TooltipProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </ErrorBoundary>
  </StrictMode>,
);
