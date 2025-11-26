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
  smartQueryLimit: number | null; // null = no auto-limit, number = apply limit
  setSmartQueryLimit: (limit: number | null) => void;

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
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      smartQueryLimit: 500, // Default: 500 rows
      setSmartQueryLimit: (limit) => {
        set({ smartQueryLimit: limit });
      },

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
        smartQueryLimit: state.smartQueryLimit,
        telemetry: state.telemetry,
      }),
    },
  ),
);
