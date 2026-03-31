import { invoke } from "@tauri-apps/api/core";

export type RuntimePlatform = 'mac' | 'windows' | 'linux';
export type CpuArch = 'arm64' | 'x86_64' | 'unknown';

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

let cachedArch: CpuArch | undefined;
let archPromise: Promise<CpuArch> | undefined;

export async function detectArch(): Promise<CpuArch> {
  if (cachedArch) return cachedArch;
  if (archPromise) return archPromise;

  archPromise = invoke<string>("get_system_arch")
    .then((arch) => {
      if (arch === "aarch64" || arch === "arm") {
        cachedArch = "arm64";
      } else if (arch === "x86_64" || arch === "x86") {
        cachedArch = "x86_64";
      } else {
        cachedArch = "unknown";
      }
      return cachedArch;
    })
    .catch(() => {
      cachedArch = "unknown";
      return cachedArch;
    });

  return archPromise;
}
