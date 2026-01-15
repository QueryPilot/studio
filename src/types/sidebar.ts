/**
 * Unified Sidebar Types
 *
 * Core type definitions for the unified sidebar adapter pattern.
 */

import type { ComponentType } from 'react';

/**
 * Generic tree node structure for all database paradigms
 */
export interface TreeNode {
  /** Unique identifier for this node */
  id: string;

  /** Type of node - paradigm-specific (e.g., 'database', 'schema', 'table', 'collection', 'key') */
  type: string;

  /** Display label */
  label: string;

  /** Whether this node can have children */
  hasChildren: boolean;

  /** Whether children are currently loading */
  isLoading?: boolean;

  /** Optional badge (count, size, etc.) */
  badge?: string | number;

  /** Paradigm-specific metadata */
  metadata: Record<string, any>;

  /** Cached children (if already loaded) */
  children?: TreeNode[];

  /** Whether node is currently expanded */
  isExpanded?: boolean;
}

/**
 * Context menu item
 */
export interface MenuItem {
  /** Unique ID for this menu item */
  id: string;

  /** Display label */
  label: string;

  /** Icon component */
  icon: ComponentType<{ className?: string }>;

  /** Click handler */
  onClick: () => void | Promise<void>;

  /** Whether this is a destructive action (red color) */
  destructive?: boolean;

  /** Whether this item is disabled */
  disabled?: boolean;

  /** Add separator after this item */
  separator?: boolean;

  /** Only show for single selection */
  requiresSingleSelection?: boolean;
}

/**
 * Sidebar adapter interface - implemented per database paradigm
 */
export interface SidebarAdapter {
  /**
   * Load root-level nodes (databases, schemas, etc.)
   */
  loadRootNodes(connectionId: string): Promise<TreeNode[]>;

  /**
   * Load children for a given node
   */
  loadChildren(node: TreeNode, connectionId: string): Promise<TreeNode[]>;

  /**
   * Filter nodes based on search query
   */
  search(query: string, nodes: TreeNode[]): TreeNode[];

  /**
   * Handle node click (open in tab, etc.)
   */
  onNodeClick(node: TreeNode, connectionId: string): void;

  /**
   * Get context menu items for selected nodes
   */
  getContextMenuItems(nodes: TreeNode[], connectionId: string): MenuItem[];

  /**
   * Get icon for a node type
   */
  getIcon(node: TreeNode): ComponentType<{ className?: string }>;

  /**
   * Check if node can be expanded
   */
  canExpand(node: TreeNode): boolean;

  /**
   * Whether this adapter supports multi-selection
   */
  supportsMultiSelect(): boolean;

  /**
   * Check if two nodes can be selected together
   */
  canSelectTogether(node1: TreeNode, node2: TreeNode): boolean;

  /**
   * Optional: Get quick actions for a node (hover buttons)
   */
  getQuickActions?(node: TreeNode, connectionId: string): MenuItem[];

  /**
   * Optional: Refresh data (called when refresh button is clicked)
   */
  refresh?(connectionId: string): Promise<void>;
}
