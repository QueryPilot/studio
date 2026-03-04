// Shared update handlers — registered by App.tsx, consumed by UI/menu.

export interface AppUpdateCheckOptions {
  manual?: boolean;
  openDialog?: boolean;
}

interface AppUpdateHandlers {
  openDialog: () => void;
  checkForUpdates: (options?: AppUpdateCheckOptions) => Promise<boolean>;
  downloadPendingUpdate: () => Promise<boolean>;
  installPendingUpdateAndRelaunch: () => Promise<boolean>;
  deferPendingUpdate: () => boolean;
}

let handlers: AppUpdateHandlers | null = null;

export function setAppUpdateHandlers(nextHandlers: AppUpdateHandlers | null) {
  handlers = nextHandlers;
}

export function openAppUpdateDialog() {
  handlers?.openDialog();
}

export async function checkForAppUpdates(
  options?: AppUpdateCheckOptions,
): Promise<boolean> {
  if (!handlers) return false;
  return handlers.checkForUpdates(options);
}

export async function downloadPendingAppUpdate(): Promise<boolean> {
  if (!handlers) return false;
  return handlers.downloadPendingUpdate();
}

export async function installPendingAppUpdateAndRelaunch(): Promise<boolean> {
  if (!handlers) return false;
  return handlers.installPendingUpdateAndRelaunch();
}

export function deferPendingAppUpdate(): boolean {
  if (!handlers) return false;
  return handlers.deferPendingUpdate();
}
