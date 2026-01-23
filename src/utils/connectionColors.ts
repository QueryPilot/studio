/**
 * Connection color utilities for multi-database workspace visual identification.
 *
 * These colors help users distinguish between multiple connections in the workspace
 * by providing consistent color coding across the UI (activity bar icons, tabs, etc.).
 */

/**
 * Array of Tailwind CSS background color classes for connection identification.
 * Colors are assigned based on connection order within a workspace.
 */
export const CONNECTION_COLORS = [
  "bg-green-500",
  "bg-blue-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-pink-500",
] as const;

/**
 * Border color variants matching CONNECTION_COLORS.
 * Used for ring/border styling on icons and tabs.
 */
export const CONNECTION_BORDER_COLORS = [
  "border-green-500",
  "border-blue-500",
  "border-purple-500",
  "border-orange-500",
  "border-pink-500",
] as const;

/**
 * Ring color variants matching CONNECTION_COLORS.
 * Used for ring styling on icons.
 */
export const CONNECTION_RING_COLORS = [
  "ring-green-500",
  "ring-blue-500",
  "ring-purple-500",
  "ring-orange-500",
  "ring-pink-500",
] as const;

export type ConnectionColorIndex = 0 | 1 | 2 | 3 | 4;

/**
 * Get the color index for a connection based on its position in the workspace.
 *
 * @param connectionId - The ID of the connection to get the color for
 * @param workspaceConnectionIds - Array of all connection IDs in the workspace (in order)
 * @returns The color index (0-4), cycling if more than 5 connections
 */
export function getConnectionColorIndex(
  connectionId: string,
  workspaceConnectionIds: string[],
): ConnectionColorIndex {
  const index = workspaceConnectionIds.indexOf(connectionId);
  // If not found, default to index 0
  if (index === -1) return 0;
  return (index % CONNECTION_COLORS.length) as ConnectionColorIndex;
}

/**
 * Get the background color class for a connection.
 *
 * @param connectionId - The ID of the connection to get the color for
 * @param workspaceConnectionIds - Array of all connection IDs in the workspace (in order)
 * @returns Tailwind CSS background color class (e.g., "bg-green-500")
 */
export function getConnectionColor(
  connectionId: string,
  workspaceConnectionIds: string[],
): string {
  const index = getConnectionColorIndex(connectionId, workspaceConnectionIds);
  return CONNECTION_COLORS[index];
}

/**
 * Get the border color class for a connection.
 *
 * @param connectionId - The ID of the connection to get the color for
 * @param workspaceConnectionIds - Array of all connection IDs in the workspace (in order)
 * @returns Tailwind CSS border color class (e.g., "border-green-500")
 */
export function getConnectionBorderColor(
  connectionId: string,
  workspaceConnectionIds: string[],
): string {
  const index = getConnectionColorIndex(connectionId, workspaceConnectionIds);
  return CONNECTION_BORDER_COLORS[index];
}

/**
 * Get the ring color class for a connection.
 *
 * @param connectionId - The ID of the connection to get the color for
 * @param workspaceConnectionIds - Array of all connection IDs in the workspace (in order)
 * @returns Tailwind CSS ring color class (e.g., "ring-green-500")
 */
export function getConnectionRingColor(
  connectionId: string,
  workspaceConnectionIds: string[],
): string {
  const index = getConnectionColorIndex(connectionId, workspaceConnectionIds);
  return CONNECTION_RING_COLORS[index];
}

/**
 * Check if color indicators should be shown.
 * Color indicators are only needed when there are 2+ connections
 * (no ambiguity when there's only one connection).
 *
 * @param connectionCount - Number of connections in the workspace
 * @returns true if color indicators should be displayed
 */
export function shouldShowConnectionColors(connectionCount: number): boolean {
  return connectionCount >= 2;
}
