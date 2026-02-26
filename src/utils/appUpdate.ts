// Shared update trigger — set by App.tsx, called by UI components

let installHandler: (() => Promise<void>) | null = null;

export function setInstallHandler(handler: (() => Promise<void>) | null) {
  installHandler = handler;
}

export function triggerAppUpdate() {
  void installHandler?.();
}
