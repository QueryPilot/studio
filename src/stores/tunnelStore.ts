import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { vaultStorage } from "@/services/vaultStorage";
import type { AuthProfile, TunnelProfile } from "@/types/tunnel";

/** Sync profiles to the Rust backend so TunnelManager can resolve auth during connect */
async function syncToBackend(
  authProfiles: AuthProfile[],
  tunnelProfiles: TunnelProfile[],
) {
  try {
    await invoke("sync_tunnel_state", {
      authProfiles,
      tunnelProfiles,
    });
  } catch (e) {
    console.warn("Failed to sync tunnel state to backend:", e);
  }
}

interface TunnelStore {
  authProfiles: AuthProfile[];
  tunnelProfiles: TunnelProfile[];
  loading: boolean;

  fetchProfiles(): Promise<void>;

  saveAuthProfile(profile: AuthProfile): Promise<void>;
  deleteAuthProfile(id: string): Promise<void>;

  saveTunnelProfile(profile: TunnelProfile): Promise<void>;
  deleteTunnelProfile(id: string): Promise<void>;

  getAuthProfile(id: string): AuthProfile | undefined;
  getTunnelProfile(id: string): TunnelProfile | undefined;
}

export const useTunnelStore = create<TunnelStore>((set, get) => ({
  authProfiles: [],
  tunnelProfiles: [],
  loading: false,

  async fetchProfiles() {
    if (get().loading) return;
    set({ loading: true });
    try {
      const [authProfiles, tunnelProfiles] = await Promise.all([
        vaultStorage.listAuthProfiles(),
        vaultStorage.listTunnelProfiles(),
      ]);
      set({ authProfiles, tunnelProfiles });
      void syncToBackend(authProfiles, tunnelProfiles);
    } finally {
      set({ loading: false });
    }
  },

  async saveAuthProfile(profile) {
    await vaultStorage.saveAuthProfile(profile);
    set((s) => {
      const idx = s.authProfiles.findIndex((p) => p.id === profile.id);
      const updated = [...s.authProfiles];
      if (idx >= 0) updated[idx] = profile;
      else updated.push(profile);
      return { authProfiles: updated };
    });
    const s = get();
    void syncToBackend(s.authProfiles, s.tunnelProfiles);
  },

  async deleteAuthProfile(id) {
    await vaultStorage.deleteAuthProfile(id);
    set((s) => {
      const updated = s.authProfiles.filter((p) => p.id !== id);
      return { authProfiles: updated };
    });
    const s = get();
    void syncToBackend(s.authProfiles, s.tunnelProfiles);
  },

  async saveTunnelProfile(profile) {
    await vaultStorage.saveTunnelProfile(profile);
    set((s) => {
      const idx = s.tunnelProfiles.findIndex((p) => p.id === profile.id);
      const updated = [...s.tunnelProfiles];
      if (idx >= 0) updated[idx] = profile;
      else updated.push(profile);
      return { tunnelProfiles: updated };
    });
    const s = get();
    void syncToBackend(s.authProfiles, s.tunnelProfiles);
  },

  async deleteTunnelProfile(id) {
    await vaultStorage.deleteTunnelProfile(id);
    set((s) => {
      const updated = s.tunnelProfiles.filter((p) => p.id !== id);
      return { tunnelProfiles: updated };
    });
    const s = get();
    void syncToBackend(s.authProfiles, s.tunnelProfiles);
  },

  getAuthProfile(id) {
    return get().authProfiles.find((p) => p.id === id);
  },

  getTunnelProfile(id) {
    return get().tunnelProfiles.find((p) => p.id === id);
  },
}));
