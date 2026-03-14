/**
 * Shared environment color definitions used across the home screen.
 *
 * Each entry provides three color variants:
 *  - `solid`       – opaque background (e.g. bg-blue-500) for dots and badge fills
 *  - `solidText`   – light text that sits on top of the solid background
 *  - `subtle`      – translucent bg + adaptive text for inline tags in lists
 */

export interface EnvColorEntry {
  /** Opaque Tailwind bg class (e.g. "bg-blue-500") */
  solid: string;
  /** Light text class for use on the solid background */
  solidText: string;
  /** Translucent bg + adaptive text for subtle inline tags */
  subtle: { bg: string; text: string };
}

type EnvColorKey = EnvKey | "production";

export const ENV_COLORS: Record<EnvColorKey, EnvColorEntry> = {
  local: {
    solid: "bg-gray-500",
    solidText: "text-gray-50",
    subtle: { bg: "bg-gray-500/20", text: "text-gray-600 dark:text-gray-400" },
  },
  dev: {
    solid: "bg-blue-500",
    solidText: "text-blue-50",
    subtle: { bg: "bg-blue-500/20", text: "text-blue-600 dark:text-blue-400" },
  },
  staging: {
    solid: "bg-yellow-500",
    solidText: "text-yellow-50",
    subtle: {
      bg: "bg-yellow-500/20",
      text: "text-yellow-600 dark:text-yellow-400",
    },
  },
  uat: {
    solid: "bg-amber-600",
    solidText: "text-amber-50",
    subtle: {
      bg: "bg-amber-500/20",
      text: "text-amber-600 dark:text-amber-400",
    },
  },
  prod: {
    solid: "bg-red-500",
    solidText: "text-red-50",
    subtle: { bg: "bg-red-500/20", text: "text-red-600 dark:text-red-400" },
  },
  production: {
    solid: "bg-red-500",
    solidText: "text-red-50",
    subtle: { bg: "bg-red-500/20", text: "text-red-600 dark:text-red-400" },
  },
  test: {
    solid: "bg-green-500",
    solidText: "text-green-50",
    subtle: {
      bg: "bg-green-500/20",
      text: "text-green-600 dark:text-green-400",
    },
  },
};

/** Ordered list of environment keys for building UI lists (excludes "production" alias). */
export const ENV_KEYS = [
  "local",
  "dev",
  "staging",
  "uat",
  "prod",
  "test",
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

/** Look up an env color entry by an arbitrary string key. Returns undefined for unknown keys. */
export function getEnvColor(key: string): EnvColorEntry | undefined {
  return (ENV_COLORS as Record<string, EnvColorEntry>)[key];
}
