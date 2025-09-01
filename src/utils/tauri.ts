/**
 * Check if running in Tauri context
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && 
         window.__TAURI_INTERNALS__ !== undefined;
}

/**
 * Safe invoke that only works in Tauri context
 */
export async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  if (!isTauri()) {
    console.warn(`Cannot invoke "${cmd}" - not running in Tauri context`);
    return null;
  }
  
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/**
 * Safe emit that only works in Tauri context
 */
export async function safeEmit(
  event: string,
  payload?: unknown
): Promise<void> {
  if (!isTauri()) {
    console.warn(`Cannot emit "${event}" - not running in Tauri context`);
    return;
  }
  
  const { emit } = await import("@tauri-apps/api/event");
  await emit(event, payload);
}

/**
 * Safe listen that only works in Tauri context
 */
export async function safeListen<T>(
  event: string,
  handler: (event: { payload: T }) => void
): Promise<(() => void) | null> {
  if (!isTauri()) {
    console.warn(`Cannot listen to "${event}" - not running in Tauri context`);
    return null;
  }
  
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<T>(event, handler);
  return unlisten;
}

// Extend Window interface for Tauri
declare global {
  interface Window {
    __TAURI_INTERNALS__?: any;
    __TAURI__?: any;
  }
}