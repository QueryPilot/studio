/**
 * Redis Sidebar Adapter
 *
 * Implements unified sidebar interface for Redis connections.
 */

import { invoke } from '@tauri-apps/api/core';
import type { SidebarAdapter, TreeNode, MenuItem } from '@/types/sidebar';
import {
  IconDatabase,
  IconKey,
  IconLayout2,
  IconEye,
  IconClock,
  IconEdit,
  IconCopy,
  IconTrash,
} from '@tabler/icons-react';
import useWorkbenchStore from '@/stores/workbenchStore';

// Redis supports 16 databases by default (0-15)
const REDIS_DATABASES = Array.from({ length: 16 }, (_, i) => i);

export class RedisSidebarAdapter implements SidebarAdapter {
  async loadRootNodes(connectionId: string): Promise<TreeNode[]> {
    try {
      // Get size of db 0 as initial check
      const size = await invoke<number>('redis_dbsize', {
        connId: connectionId,
      });

      return REDIS_DATABASES.map((dbIndex) => ({
        id: `db:${dbIndex}`,
        type: 'database',
        label: `db${dbIndex}`,
        hasChildren: true,
        badge: dbIndex === 0 ? `${size} keys` : undefined,
        metadata: { dbIndex },
      }));
    } catch (error) {
      console.error('Failed to load Redis databases:', error);
      // Still return databases even if dbsize fails
      return REDIS_DATABASES.map((dbIndex) => ({
        id: `db:${dbIndex}`,
        type: 'database',
        label: `db${dbIndex}`,
        hasChildren: true,
        metadata: { dbIndex },
      }));
    }
  }

  async loadChildren(node: TreeNode, connectionId: string): Promise<TreeNode[]> {
    if (node.type === 'database') {
      try {
        const dbIndex = node.metadata.dbIndex as number;

        // Switch to this database
        await invoke('keyvalue_execute', {
          connId: connectionId,
          operation: { type: 'selectDb', index: dbIndex as number },
        });

        // Scan keys (limit to first 100 for performance)
        const result = await invoke<{
          keys: Array<{ key: string; type?: string }>;
          cursor: number;
        }>('redis_scan_keys', {
          connId: connectionId,
          cursor: 0,
          pattern: '*',
          count: 100,
        });

        if (!result.keys || result.keys.length === 0) {
          return [];
        }

        // Group keys by prefix
        const groups = new Map<string, number>();
        const ungroupedKeys: string[] = [];

        for (const keyInfo of result.keys) {
          const parts = keyInfo.key.split(':');
          if (parts.length > 1 && parts[0]) {
            const prefix = parts[0];
            groups.set(prefix, (groups.get(prefix) || 0) + 1);
          } else {
            ungroupedKeys.push(keyInfo.key);
          }
        }

        const children: TreeNode[] = [];

        // Add key groups
        for (const [prefix, count] of Array.from(groups.entries()).sort()) {
          children.push({
            id: `keygroup:${dbIndex}:${prefix}`,
            type: 'key-group',
            label: prefix,
            hasChildren: false,
            badge: count,
            metadata: {
              dbIndex,
              prefix,
              pattern: `${prefix}:*`,
            },
          });
        }

        // Add individual ungrouped keys
        for (const key of ungroupedKeys.slice(0, 10)) {
          children.push({
            id: `key:${dbIndex}:${key}`,
            type: 'key',
            label: key,
            hasChildren: false,
            metadata: {
              dbIndex,
              key,
            },
          });
        }

        return children;
      } catch (error) {
        console.error('Failed to load Redis keys:', error);
        return [];
      }
    }

    return [];
  }

  search(query: string, nodes: TreeNode[]): TreeNode[] {
    const lowerQuery = query.toLowerCase();
    const results: TreeNode[] = [];

    for (const node of nodes) {
      if (node.label.toLowerCase().includes(lowerQuery)) {
        results.push(node);
      }

      if (node.children) {
        const childResults = this.search(query, node.children);
        if (childResults.length > 0) {
          results.push({
            ...node,
            children: childResults,
            isExpanded: true,
          });
        }
      }
    }

    return results;
  }

  onNodeClick(node: TreeNode, connectionId: string): void {
    if (node.type === 'key-group') {
      const dbIndex = node.metadata.dbIndex as number;
      const prefix = node.metadata.prefix as string;

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

      if (!targetPanelId) return;

      const tabId = `redis-db${dbIndex}-${prefix}`;
      addTab(targetPanelId, tabId, {
        type: 'redis-key',
        title: `Browser: ${prefix}*`,
        connectionId,
        database: String(dbIndex),
      });
    } else if (node.type === 'key') {
      const dbIndex = node.metadata.dbIndex as number;
      const key = node.metadata.key as string;

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

      if (!targetPanelId) return;

      const tabId = `redis-key-${dbIndex}-${key}`;
      addTab(targetPanelId, tabId, {
        type: 'redis-key',
        title: key,
        connectionId,
        database: String(dbIndex),
        table: key, // Use table field for selected key
      });
    } else if (node.type === 'database') {
      // Open database browser
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

      if (!targetPanelId) return;

      const tabId = `redis-db${dbIndex}-keys`;
      addTab(targetPanelId, tabId, {
        type: 'redis-key',
        title: `DB ${dbIndex} Keys`,
        connectionId,
        database: String(dbIndex),
      });
    }
  }

  getContextMenuItems(nodes: TreeNode[], connectionId: string): MenuItem[] {
    if (nodes.length === 0) return [];

    const firstNode = nodes[0];
    if (!firstNode) return [];

    if (firstNode.type === 'key') {
      const items: MenuItem[] = [
        {
          id: 'view-value',
          label: 'View Value',
          icon: IconEye,
          onClick: () => {
            this.onNodeClick(firstNode, connectionId);
          },
        },
        {
          id: 'set-ttl',
          label: 'Set TTL',
          icon: IconClock,
          onClick: () => {
            // TODO: Open TTL dialog
            console.log('Set TTL:', firstNode);
          },
        },
        {
          id: 'rename',
          label: 'Rename Key',
          icon: IconEdit,
          onClick: () => {
            // TODO: Open rename dialog
            console.log('Rename key:', firstNode);
          },
        },
        {
          id: 'copy-name',
          label: 'Copy Key Name',
          icon: IconCopy,
          onClick: async () => {
            await navigator.clipboard.writeText(firstNode.label);
          },
        },
        {
          id: 'copy-value',
          label: 'Copy Value',
          icon: IconCopy,
          onClick: async () => {
            // TODO: Fetch and copy value
            console.log('Copy value:', firstNode);
          },
          separator: true,
        },
        {
          id: 'delete',
          label: 'Delete Key...',
          icon: IconTrash,
          destructive: true,
          onClick: () => {
            // TODO: Show confirmation dialog
            console.log('Delete key:', firstNode);
          },
        },
      ];

      return items;
    }

    if (firstNode.type === 'key-group') {
      return [
        {
          id: 'browse',
          label: 'Browse Keys',
          icon: IconEye,
          onClick: () => {
            this.onNodeClick(firstNode, connectionId);
          },
        },
        {
          id: 'copy-pattern',
          label: 'Copy Pattern',
          icon: IconCopy,
          onClick: async () => {
            const pattern = firstNode.metadata.pattern as string;
            await navigator.clipboard.writeText(pattern);
          },
        },
      ];
    }

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
        {
          id: 'flush',
          label: 'Flush Database...',
          icon: IconTrash,
          destructive: true,
          onClick: () => {
            // TODO: Show confirmation dialog
            console.log('Flush database:', firstNode);
          },
        },
      ];
    }

    return [];
  }

  getIcon(node: TreeNode) {
    switch (node.type) {
      case 'database':
        return IconDatabase;
      case 'key-group':
        return IconLayout2;
      case 'key':
        return IconKey;
      default:
        return IconKey;
    }
  }

  canExpand(node: TreeNode): boolean {
    return node.hasChildren;
  }

  supportsMultiSelect(): boolean {
    return false; // Redis adapter doesn't support multi-select yet
  }

  canSelectTogether(node1: TreeNode, node2: TreeNode): boolean {
    return node1.type === node2.type;
  }
}
