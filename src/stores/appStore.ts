import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PendingAppUpdate {
  version: string;
  body?: string;
  date?: string;
  downloaded: boolean;
}

interface AppState {
  theme: "light" | "dark" | "system";
  /** Zoom level as a percentage (75–150). Default 100. */
  zoomLevel: number;
  /** Whether an update check is in progress */
  isCheckingForUpdate: boolean;
  /** Whether update package download is in progress */
  isDownloadingUpdate: boolean;
  /** Available app update waiting to be installed */
  pendingUpdate: PendingAppUpdate | null;
  /** Whether the update is currently being installed */
  isInstallingUpdate: boolean;
  /** Last update flow error message */
  updateError: string | null;
  /** Whether the update dialog is open */
  isUpdateDialogOpen: boolean;
  /** Version queued for deferred install on next startup */
  deferredUpdateVersion: string | null;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setZoomLevel: (level: number) => void;
  setPendingUpdate: (update: PendingAppUpdate | null) => void;
  markPendingUpdateDownloaded: (downloaded: boolean) => void;
  setIsCheckingForUpdate: (checking: boolean) => void;
  setIsDownloadingUpdate: (downloading: boolean) => void;
  setIsInstallingUpdate: (installing: boolean) => void;
  setUpdateError: (message: string | null) => void;
  openUpdateDialog: () => void;
  closeUpdateDialog: () => void;
  setDeferredUpdateVersion: (version: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: "system",
      zoomLevel: 100,
      isCheckingForUpdate: false,
      isDownloadingUpdate: false,
      pendingUpdate: null,
      isInstallingUpdate: false,
      updateError: null,
      isUpdateDialogOpen: false,
      deferredUpdateVersion: null,
      setTheme: (theme) => {
        set({ theme });
      },
      setZoomLevel: (level) => {
        set({ zoomLevel: Math.min(Math.max(level, 75), 150) });
      },
      setPendingUpdate: (update) => {
        set({ pendingUpdate: update });
      },
      markPendingUpdateDownloaded: (downloaded) => {
        set((state) => ({
          pendingUpdate: state.pendingUpdate
            ? {
                ...state.pendingUpdate,
                downloaded,
              }
            : state.pendingUpdate,
        }));
      },
      setIsCheckingForUpdate: (checking) => {
        set({ isCheckingForUpdate: checking });
      },
      setIsDownloadingUpdate: (downloading) => {
        set({ isDownloadingUpdate: downloading });
      },
      setIsInstallingUpdate: (installing) => {
        set({ isInstallingUpdate: installing });
      },
      setUpdateError: (message) => {
        set({ updateError: message });
      },
      openUpdateDialog: () => {
        set({ isUpdateDialogOpen: true });
      },
      closeUpdateDialog: () => {
        set({ isUpdateDialogOpen: false });
      },
      setDeferredUpdateVersion: (version) => {
        set({ deferredUpdateVersion: version });
      },
    }),
    {
      name: "app-store",
      partialize: (state) => ({
        theme: state.theme,
        zoomLevel: state.zoomLevel,
        deferredUpdateVersion: state.deferredUpdateVersion,
      }),
    },
  ),
);
