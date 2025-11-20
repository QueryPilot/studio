import ReactDOM from "react-dom/client";
import "./styles/globals.css";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";
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
import { initializeSentry } from "./utils/sentry";
import { usePreferencesStore } from "./stores/preferencesStore";
import { UpdateChecker } from "./components/UpdateChecker";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
enableMapSet();

// Initialize Sentry for error tracking (only in production, opt-in via preferences)
const telemetryPrefs = usePreferencesStore.getState().telemetry;
initializeSentry(telemetryPrefs, "0.4.0");

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
    // Block native menu on context menu content itself to prevent double menus
    const target = e.target as HTMLElement;
    const isOnContextMenu =
      target.closest('[data-slot="context-menu-content"]') ||
      target.closest("[data-radix-context-menu-content]");

    if (isOnContextMenu) {
      e.preventDefault();
      e.stopPropagation();
    }
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
            <App />
            <Toaster richColors closeButton />
            <CommandPalette />
            <UpdateChecker checkOnMount={true} />
          </ThemeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </ErrorBoundary>
  </StrictMode>,
);
