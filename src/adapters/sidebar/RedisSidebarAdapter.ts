/**
 * Redis Sidebar Adapter
 *
 * Simplified implementation that shows databases only.
 * Clicking a database opens a Key Browser with pattern filtering support.
 */

import { invoke } from '@tauri-apps/api/core';
import type { SidebarAdapter, TreeNode, MenuItem } from '@/types/sidebar';
import {
  IconDatabase,
  IconEye,
} from '@tabler/icons-react';
import useWorkbenchStore from '@/stores/workbenchStore';
import { toast } from 'sonner';

// Redis supports 16 databases by default (0-15)
const REDIS_DATABASES = Array.from({ length: 16 }, (_, i) => i);

export class RedisSidebarAdapter implements SidebarAdapter {
  async loadRootNodes(connectionId: string): Promise<TreeNode[]> {
    try {
      // Get size for each database that has keys
      const dbSizes = await Promise.all(
        REDIS_DATABASES.map(async (dbIndex) => {
          try {
            // Switch to database and get size
            await invoke('keyvalue_execute', {
              connId: connectionId,
              operation: { type: 'selectDb', index: dbIndex },
            });
            const result = await invoke<{ type: string; data?: number }>('keyvalue_execute', {
              connId: connectionId,
              operation: { type: 'dbSize' },
            });
            return result.type === 'count' ? (result.data ?? 0) : 0;
          } catch {
            return 0;
          }
        })
      );

      // Switch back to db0
      await invoke('keyvalue_execute', {
        connId: connectionId,
        operation: { type: 'selectDb', index: 0 },
      });

      return REDIS_DATABASES.map((dbIndex) => ({
        id: `db:${dbIndex}`,
        type: 'database',
        label: `db${dbIndex}`,
        hasChildren: false, // Databases don't expand - click to open Key Browser
        badge: dbSizes[dbIndex] ? `${dbSizes[dbIndex]} keys` : undefined,
        metadata: { dbIndex, keyCount: dbSizes[dbIndex] ?? 0 },
      }));
    } catch (error) {
      console.error('Failed to load Redis databases:', error);
      // Still return databases even if dbsize fails
      return REDIS_DATABASES.map((dbIndex) => ({
        id: `db:${dbIndex}`,
        type: 'database',
        label: `db${dbIndex}`,
        hasChildren: false,
        metadata: { dbIndex, keyCount: 0 },
      }));
    }
  }

  async loadChildren(_node: TreeNode, _connectionId: string): Promise<TreeNode[]> {
    // Databases don't have children in the sidebar anymore
    // Keys are shown in the Key Browser DataGrid
    return [];
  }

  search(query: string, nodes: TreeNode[]): TreeNode[] {
    const lowerQuery = query.toLowerCase();
    return nodes.filter((node) => node.label.toLowerCase().includes(lowerQuery));
  }

  onNodeClick(node: TreeNode, connectionId: string): void {
    try {
      if (node.type === 'database') {
        const dbIndex = node.metadata.dbIndex as number;

        const { focusedPanelId, addTab, panelContents, focusPanel } =
          useWorkbenchStore.getState();

        let targetPanelId = focusedPanelId;
        if (!targetPanelId && panelContents.size > 0) {
          const firstPanelId = Array.from(panelContents.keys())[0];
          if (firstPanelId) {
            targetPanelId = firstPanelId;
            focusPanel(firstPanelId);
          }
        }

        if (!targetPanelId) {
          toast.error('No panel available', {
            description: 'Could not find a panel to open the database',
          });
          return;
        }

        const tabId = `redis-db${dbIndex}-browser`;
        addTab(targetPanelId, tabId, {
          type: 'redis-key',
          title: `db${dbIndex}`,
          connectionId,
          database: String(dbIndex),
          // No 'table' field = browser mode
        });
      }
    } catch (error) {
      toast.error(`Failed to open ${node.label}`, {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getContextMenuItems(nodes: TreeNode[], connectionId: string): MenuItem[] {
    if (nodes.length === 0) return [];

    const firstNode = nodes[0];
    if (!firstNode) return [];

    if (firstNode.type === 'database') {
      return [
        {
          id: 'browse',
          label: 'Browse Keys',
          icon: IconEye,
          onClick: () => {
            this.onNodeClick(firstNode, connectionId);
          },
        },
        // Future actions: Flush Database
      ];
    }

    return [];
  }

  getIcon(node: TreeNode) {
    switch (node.type) {
      case 'database':
        return IconDatabase;
      default:
        return IconDatabase;
    }
  }

  canExpand(_node: TreeNode): boolean {
    return false; // Databases don't expand - click to open Key Browser
  }

  supportsMultiSelect(): boolean {
    return false;
  }

  canSelectTogether(node1: TreeNode, node2: TreeNode): boolean {
    return node1.type === node2.type;
  }
}
