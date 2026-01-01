import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PreferenceCategory =
  | "general"
  | "editor"
  | "ai"
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

  // Query execution preferences
  smartQueryLimit: number | null;
  setSmartQueryLimit: (limit: number | null) => void;
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

      // Query execution defaults
      smartQueryLimit: 5000,
      setSmartQueryLimit: (limit) => {
        set({ smartQueryLimit: limit });
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
        smartQueryLimit: state.smartQueryLimit,
      }),
    },
  ),
);
