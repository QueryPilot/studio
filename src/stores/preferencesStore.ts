import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PreferenceCategory =
  | "general"
  | "editor"
  | "shortcuts"
  | "globalShortcuts"
  | "telemetry";

export interface TelemetryPreferences {
  sentryEnabled: boolean; // Enable crash reporting to Sentry
  performanceMonitoring: boolean; // Track performance metrics
  sessionReplay: boolean; // Record session replays on errors (privacy-sensitive)
}

interface PreferencesState {
  // Telemetry preferences
  telemetry: TelemetryPreferences;
  setTelemetry: (telemetry: Partial<TelemetryPreferences>) => void;

  // Preferences dialog state
  isOpen: boolean;
  activeCategory: PreferenceCategory;
  openPreferences: (category?: PreferenceCategory) => void;
  closePreferences: () => void;
  setActiveCategory: (category: PreferenceCategory) => void;

  // Unsaved changes tracking
  unsavedChanges: boolean;
  setUnsavedChanges: (hasChanges: boolean) => void;

  /** Query timeout in seconds. Default: 300 (5 minutes). Set to 0 for no timeout. */
  queryTimeoutSecs: number;
  setQueryTimeoutSecs: (timeout: number) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      // Telemetry defaults (all disabled by default for privacy)
      telemetry: {
        sentryEnabled: false,
        performanceMonitoring: false,
        sessionReplay: false,
      },
      setTelemetry: (telemetry) => {
        set((state) => ({
          telemetry: { ...state.telemetry, ...telemetry },
        }));
      },

      // Query timeout (5 minutes default, 0 = no timeout)
      queryTimeoutSecs: 300,
      setQueryTimeoutSecs: (timeout) => {
        set({ queryTimeoutSecs: timeout });
      },

      // Dialog state (not persisted)
      isOpen: false,
      activeCategory: "general",
      openPreferences: (category = "general") => {
        set({ isOpen: true, activeCategory: category });
      },
      closePreferences: () => {
        set({ isOpen: false, unsavedChanges: false });
      },
      setActiveCategory: (category) => {
        set({ activeCategory: category });
      },

      // Unsaved changes
      unsavedChanges: false,
      setUnsavedChanges: (hasChanges) => {
        set({ unsavedChanges: hasChanges });
      },
    }),
    {
      name: "query-pilot-preferences",
      partialize: (state) => ({
        telemetry: state.telemetry,
        queryTimeoutSecs: state.queryTimeoutSecs,
      }),
    },
  ),
);
