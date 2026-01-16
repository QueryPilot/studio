/**
 * MongoDB Sidebar Adapter
 *
 * Implements unified sidebar interface for MongoDB connections.
 */

import { invoke } from '@tauri-apps/api/core';
import type { SidebarAdapter, TreeNode, MenuItem } from '@/types/sidebar';
import {
  IconDatabase,
  IconLayout2,
  IconEye,
  IconBookmark,
  IconPlus,
  IconChartBar,
  IconDownload,
  IconCopy,
  IconTrash,
} from '@tabler/icons-react';
import useWorkbenchStore from '@/stores/workbenchStore';
import { toast } from 'sonner';

export class MongoSidebarAdapter implements SidebarAdapter {
  async loadRootNodes(connectionId: string): Promise<TreeNode[]> {
    try {
      const databases = await invoke<{ name: string }[]>('mongo_list_databases', {
        connId: connectionId,
      });

      return databases.map((db) => ({
        id: `db:${db.name}`,
        type: 'database',
        label: db.name,
        hasChildren: true,
        metadata: { database: db.name },
      }));
    } catch (error) {
      console.error('Failed to load MongoDB databases:', error);
      return [];
    }
  }

  async loadChildren(node: TreeNode, connectionId: string): Promise<TreeNode[]> {
    if (node.type === 'database') {
      try {
        // Set current database context before fetching collections
        const database = node.metadata.database as string;

        const collections = await invoke<{ name: string; type: string }[]>(
          'mongo_list_collections',
          { connId: connectionId }
        );

        return collections.map((collection) => ({
          id: `collection:${database}:${collection.name}`,
          type: 'collection',
          label: collection.name,
          hasChildren: false,
          metadata: {
            database,
            collection: collection.name,
            collectionType: collection.type,
          },
        }));
      } catch (error) {
        console.error('Failed to load MongoDB collections:', error);
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
    try {
      if (node.type === 'collection') {
        const database = node.metadata.database as string;
        const collection = node.metadata.collection as string;

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
            description: 'Could not find a panel to open the collection',
          });
          return;
        }

        const tabId = `mongo-${database}-${collection}`;
        addTab(targetPanelId, tabId, {
          type: 'mongo-collection',
          title: collection,
          connectionId,
          database,
          table: collection,
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

    if (firstNode.type === 'collection') {
      const items: MenuItem[] = [
        {
          id: 'view-docs',
          label: 'View Documents',
          icon: IconEye,
          onClick: () => {
            this.onNodeClick(firstNode, connectionId);
          },
        },
        {
          id: 'copy-name',
          label: 'Copy Collection Name',
          icon: IconCopy,
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(firstNode.label);
              toast.success('Copied to clipboard', {
                description: `Collection name: ${firstNode.label}`,
              });
            } catch (error) {
              toast.error('Failed to copy', {
                description: error instanceof Error ? error.message : String(error),
              });
            }
          },
          separator: true,
        },
        // Future actions: View Indexes, Create Index, Collection Stats, Export, Drop
      ];

      return items;
    }

    if (firstNode.type === 'database') {
      return [
        {
          id: 'copy-name',
          label: 'Copy Database Name',
          icon: IconCopy,
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(firstNode.label);
              toast.success('Copied to clipboard', {
                description: `Database name: ${firstNode.label}`,
              });
            } catch (error) {
              toast.error('Failed to copy', {
                description: error instanceof Error ? error.message : String(error),
              });
            }
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
      case 'collection':
        return IconLayout2;
      default:
        return IconLayout2;
    }
  }

  canExpand(node: TreeNode): boolean {
    return node.hasChildren;
  }

  supportsMultiSelect(): boolean {
    return false; // MongoDB adapter doesn't support multi-select yet
  }

  canSelectTogether(node1: TreeNode, node2: TreeNode): boolean {
    return node1.type === node2.type;
  }
}
