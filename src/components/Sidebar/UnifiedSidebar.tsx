/**
 * Unified Sidebar Component
 *
 * Single sidebar component that works with any database paradigm via adapters.
 */

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  IconSearch,
  IconRefresh,
  IconChevronRight,
  IconChevronDown,
} from '@tabler/icons-react';
import type { SidebarAdapter, TreeNode } from '@/types/sidebar';
import { UnifiedContextMenu } from './UnifiedContextMenu';

interface UnifiedSidebarProps {
  connectionId: string;
  adapter: SidebarAdapter;
  isLoading?: boolean;
  className?: string;
}

export function UnifiedSidebar({
  connectionId,
  adapter,
  isLoading: initialLoading,
  className,
}: UnifiedSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodes: TreeNode[];
  } | null>(null);

  const lastSelectedRef = useRef<string | null>(null);

  // Load root nodes on mount
  useEffect(() => {
    if (connectionId && !initialLoading) {
      void loadRootNodes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, initialLoading]);

  const loadRootNodes = async () => {
    try {
      setIsRefreshing(true);
      setError(null);
      const nodes = await adapter.loadRootNodes(connectionId);
      setRootNodes(nodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadChildren = async (node: TreeNode) => {
    if (node.children) return; // Already loaded

    try {
      const children = await adapter.loadChildren(node, connectionId);
      setRootNodes((prev) => updateNodeChildren(prev, node.id, children));
    } catch (err) {
      console.error('Failed to load children:', err);
    }
  };

  const updateNodeChildren = (
    nodes: TreeNode[],
    nodeId: string,
    children: TreeNode[]
  ): TreeNode[] => {
    return nodes.map((node) => {
      if (node.id === nodeId) {
        return { ...node, children, isLoading: false };
      }
      if (node.children) {
        return {
          ...node,
          children: updateNodeChildren(node.children, nodeId, children),
        };
      }
      return node;
    });
  };

  const toggleNode = async (nodeId: string) => {
    const node = findNode(rootNodes, nodeId);
    if (!node) return;

    if (expandedNodes.has(nodeId)) {
      // Collapse
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    } else {
      // Expand
      setExpandedNodes((prev) => new Set(prev).add(nodeId));
      if (!node.children && adapter.canExpand(node)) {
        await loadChildren(node);
      }
    }
  };

  const findNode = (nodes: TreeNode[], nodeId: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === nodeId) return node;
      if (node.children) {
        const found = findNode(node.children, nodeId);
        if (found) return found;
      }
    }
    return null;
  };

  const handleNodeClick = (node: TreeNode, event: React.MouseEvent) => {
    const supportsMulti = adapter.supportsMultiSelect();

    if (supportsMulti && (event.ctrlKey || event.metaKey)) {
      // Toggle selection
      setSelectedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
      lastSelectedRef.current = node.id;
    } else if (supportsMulti && event.shiftKey && lastSelectedRef.current) {
      // Range selection
      const flatNodes = flattenNodes(rootNodes);
      const lastIndex = flatNodes.findIndex((n) => n.id === lastSelectedRef.current);
      const currentIndex = flatNodes.findIndex((n) => n.id === node.id);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeNodes = flatNodes.slice(start, end + 1);

        setSelectedNodes((prev) => {
          const next = new Set(prev);
          rangeNodes.forEach((n) => next.add(n.id));
          return next;
        });
      }
    } else {
      // Single selection + action
      setSelectedNodes(new Set([node.id]));
      lastSelectedRef.current = node.id;
      adapter.onNodeClick(node, connectionId);
    }
  };

  const handleContextMenu = (node: TreeNode, event: React.MouseEvent) => {
    event.preventDefault();

    // If node not selected, select only this node
    if (!selectedNodes.has(node.id)) {
      setSelectedNodes(new Set([node.id]));
      lastSelectedRef.current = node.id;
    }

    // Get all selected nodes
    const selected = Array.from(selectedNodes)
      .map((id) => findNode(rootNodes, id))
      .filter((n): n is TreeNode => n !== null);

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      nodes: selected,
    });
  };

  const flattenNodes = (nodes: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = [];
    const traverse = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        result.push(node);
        if (node.children && expandedNodes.has(node.id)) {
          traverse(node.children);
        }
      }
    };
    traverse(nodes);
    return result;
  };

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const isExpanded = expandedNodes.has(node.id);
    const isSelected = selectedNodes.has(node.id);
    const canExpand = adapter.canExpand(node);
    const Icon = adapter.getIcon(node);

    return (
      <div key={node.id}>
        <button
          className={cn(
            'flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded hover:bg-accent',
            isSelected && 'bg-accent',
            'select-none'
          )}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={(e) => {
            if (canExpand) {
              toggleNode(node.id);
            } else {
              handleNodeClick(node, e);
            }
          }}
          onContextMenu={(e) => {
            handleContextMenu(node, e);
          }}
        >
          {canExpand && (
            <>
              {node.isLoading ? (
                <div className="h-3 w-3 border border-primary border-t-transparent rounded-full animate-spin" />
              ) : isExpanded ? (
                <IconChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <IconChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
            </>
          )}
          {!canExpand && <div className="w-3" />}
          <Icon className="h-3.5 w-3.5" />
          <span className="truncate flex-1 text-left">{node.label}</span>
          {node.badge && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {node.badge}
            </span>
          )}
        </button>

        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const filteredNodes = searchQuery
    ? adapter.search(searchQuery, rootNodes)
    : rootNodes;

  if (initialLoading) {
    return (
      <div className={cn('flex flex-col h-full p-2 space-y-2', className)}>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-6 w-1/2" />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Search and Refresh */}
      <div className="flex items-center gap-1 p-2 border-b">
        <div className="relative flex-1">
          <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={loadRootNodes}
          disabled={isRefreshing}
        >
          <IconRefresh
            className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')}
          />
        </Button>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-2 text-xs text-destructive select-text bg-destructive/10 m-2 rounded">
          {error}
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-1">
        {filteredNodes.length === 0 && !isRefreshing && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No items found
          </div>
        )}

        {filteredNodes.map((node) => renderNode(node, 0))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <UnifiedContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={adapter.getContextMenuItems(contextMenu.nodes, connectionId)}
          onClose={() => {
            setContextMenu(null);
          }}
        />
      )}
    </div>
  );
}
