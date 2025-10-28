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

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
enableMapSet();

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
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        storageKey="query-pilot-theme"
      >
        <App />
        <Toaster richColors closeButton />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
