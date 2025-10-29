export type RuntimePlatform = 'mac' | 'windows' | 'linux';

let cachedPlatform: RuntimePlatform | undefined;

function resolvePlatformFromUserAgent(userAgent: string): RuntimePlatform {
  const lower = userAgent.toLowerCase();

  if (lower.includes('mac') || lower.includes('darwin')) {
    return 'mac';
  }

  if (lower.includes('win')) {
    return 'windows';
  }

  return 'linux';
}

export function detectPlatform(): RuntimePlatform {
  if (cachedPlatform) {
    return cachedPlatform;
  }

  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    cachedPlatform = resolvePlatformFromUserAgent(navigator.userAgent);
    return cachedPlatform;
  }

  if (typeof process !== 'undefined' && typeof process.platform === 'string') {
    switch (process.platform) {
      case 'darwin':
        cachedPlatform = 'mac';
        break;
      case 'win32':
        cachedPlatform = 'windows';
        break;
      default:
        cachedPlatform = 'linux';
        break;
    }
    return cachedPlatform;
  }

  cachedPlatform = 'windows';
  return cachedPlatform;
}

export function setRuntimePlatform(platform: RuntimePlatform): void {
  cachedPlatform = platform;
}

export const isMac = (): boolean => detectPlatform() === 'mac';
export const isWindows = (): boolean => detectPlatform() === 'windows';
export const isLinux = (): boolean => detectPlatform() === 'linux';
