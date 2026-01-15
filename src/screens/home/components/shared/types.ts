/**
 * Common types for home screen components
 */

export interface DeleteDialogState {
  isOpen: boolean;
  workspaceId: string | null;
  workspaceName: string;
  connectionCount: number;
}
