/**
 * Workspace File Service
 *
 * Handles import/export of .qpworkspace files for sharing and version control.
 */

import { logger } from "@/lib/logger";
import { save, open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import type { WorkspaceConfig } from "@/types/workspace";
import type { ConnectionProfile, DbType } from "@/types/connection";

/**
 * File format for .qpworkspace files (JSON).
 * Note: Passwords are NOT included for security.
 */
export interface QpWorkspaceFile {
  version: 1;
  name: string;
  icon?: string;
  connections: Array<{
    // Embedded connection profile (for portability)
    name: string;
    db_type: DbType;
    host: string;
    port: number;
    database: string;
    username: string;
    // Password NOT included - prompted on open

    // Default state
    defaultDatabase?: string;
    defaultSchema?: string;
  }>;
  createdAt: string;
  exportedAt: string;
}

/**
 * Result from importing a workspace file.
 */
export interface WorkspaceImportResult {
  workspace: WorkspaceConfig;
  newConnections: ConnectionProfile[];
  existingConnections: string[]; // IDs of connections that already exist
  missingPasswords: string[]; // Names of connections that need passwords
}

class WorkspaceFileService {
  /**
   * Export a workspace to a .qpworkspace file.
   * User selects save location via file dialog.
   */
  async exportWorkspace(workspaceId: string): Promise<string | null> {
    const workspace = useWorkspaceBundleStore
      .getState()
      .savedWorkspaces.find((ws) => ws.id === workspaceId);

    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const connections = useConnectionStore.getState().connections;
    const workspaceConnections = workspace.connectionIds
      .map((id) => connections.find((c) => c.profile.id === id)?.profile)
      .filter((p): p is ConnectionProfile => p !== undefined);

    const fileData: QpWorkspaceFile = {
      version: 1,
      name: workspace.name,
      icon: workspace.icon,
      connections: workspaceConnections.map((profile) => ({
        name: profile.name,
        db_type: profile.db_type,
        host: profile.host,
        port: profile.port,
        database: profile.database,
        username: profile.username,
        defaultDatabase: workspace.connectionStates[profile.id]?.database,
        defaultSchema: workspace.connectionStates[profile.id]?.schema,
      })),
      createdAt: workspace.createdAt,
      exportedAt: new Date().toISOString(),
    };

    // Show save dialog
    const filePath = await save({
      defaultPath: `${workspace.name.replace(/[^a-z0-9]/gi, "_")}.qpworkspace`,
      filters: [
        {
          name: "Query Pilot Workspace",
          extensions: ["qpworkspace"],
        },
      ],
    });

    if (!filePath) {
      return null; // User cancelled
    }

    // Write file using Rust backend
    const content = JSON.stringify(fileData, null, 2);
    await invoke("write_text_file", { path: filePath, content });
    logger.info(`[WorkspaceFileService] Exported workspace to: ${filePath}`);

    return filePath;
  }

  /**
   * Import a workspace from a .qpworkspace file.
   * User selects file via file dialog.
   */
  async importWorkspace(): Promise<WorkspaceImportResult | null> {
    // Show open dialog
    const filePath = await open({
      filters: [
        {
          name: "Query Pilot Workspace",
          extensions: ["qpworkspace"],
        },
      ],
      multiple: false,
    });

    if (!filePath) {
      return null; // User cancelled
    }

    return this.importWorkspaceFromPath(filePath);
  }

  /**
   * Import a workspace from a specific file path.
   */
  async importWorkspaceFromPath(
    filePath: string,
  ): Promise<WorkspaceImportResult> {
    // Read and parse file using Rust backend
    const content = await invoke<string>("read_text_file", { path: filePath });
    const fileData = JSON.parse(content) as QpWorkspaceFile;

    // Validate version (future-proofing for when we add new versions)
    const version = fileData.version as number;
    if (version !== 1) {
      throw new Error(`Unsupported workspace file version: ${version}`);
    }

    const connectionStore = useConnectionStore.getState();
    const existingConnections: string[] = [];
    const newConnections: ConnectionProfile[] = [];
    const missingPasswords: string[] = [];
    const connectionIds: string[] = [];
    const connectionStates: WorkspaceConfig["connectionStates"] = {};

    // Process each connection
    for (const connData of fileData.connections) {
      // Check if a connection with same host/port/database/username exists
      const existing = connectionStore.connections.find(
        (c) =>
          c.profile.host === connData.host &&
          c.profile.port === connData.port &&
          c.profile.database === connData.database &&
          c.profile.username === connData.username,
      );

      if (existing) {
        existingConnections.push(existing.profile.id);
        connectionIds.push(existing.profile.id);
        connectionStates[existing.profile.id] = {
          database: connData.defaultDatabase || connData.database,
          schema: connData.defaultSchema || "public",
        };
      } else {
        // Create new connection profile (without password)
        const newProfile: ConnectionProfile = {
          id: crypto.randomUUID(),
          name: connData.name,
          db_type: connData.db_type,
          host: connData.host,
          port: connData.port,
          database: connData.database,
          username: connData.username,
          password: "", // Will need to be entered
          options: {},
        };

        newConnections.push(newProfile);
        missingPasswords.push(connData.name);
        connectionIds.push(newProfile.id);
        connectionStates[newProfile.id] = {
          database: connData.defaultDatabase || connData.database,
          schema: connData.defaultSchema || "public",
        };
      }
    }

    // Create workspace config
    const now = new Date().toISOString();
    const workspace: WorkspaceConfig = {
      id: crypto.randomUUID(),
      name: fileData.name,
      icon: fileData.icon,
      connectionIds,
      connectionStates,
      createdAt: now,
      updatedAt: now,
    };

    logger.info(
      `[WorkspaceFileService] Imported workspace: ${workspace.name} with ${connectionIds.length} connections`,
    );

    return {
      workspace,
      newConnections,
      existingConnections,
      missingPasswords,
    };
  }

  /**
   * Open a .qpworkspace file and immediately open the workspace.
   * This is for double-click to open functionality.
   */
  async openWorkspaceFile(filePath: string): Promise<string> {
    const result = await this.importWorkspaceFromPath(filePath);

    // Save new connections (they'll need passwords before connecting)
    const connectionStore = useConnectionStore.getState();
    for (const profile of result.newConnections) {
      await connectionStore.saveConnection(profile, []);
    }

    // Save workspace
    const bundleStore = useWorkspaceBundleStore.getState();
    await bundleStore.createWorkspace(
      result.workspace.name,
      result.workspace.connectionIds,
    );

    // Note: Can't open immediately if passwords are missing
    // The UI should prompt for passwords first

    return result.workspace.id;
  }
}

export const workspaceFileService = new WorkspaceFileService();
