import type {
  GridNode,
  Direction,
  Orientation,
  PanelContent,
  WorkbenchConstraints,
} from "@/types/workbench";

export const CONSTRAINTS: WorkbenchConstraints = {
  MAX_HORIZONTAL_PANELS: 4,
  MAX_VERTICAL_PANELS: 2, // Increased since we now use per-branch constraints
  MIN_PANEL_WIDTH: 200,
  MIN_PANEL_HEIGHT: 150,
  MIN_SPLIT_RATIO: 0.1,
  MAX_SPLIT_RATIO: 0.9,
  MAX_TREE_DEPTH: 5,
};

export function generateId(): string {
  return `panel-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function createLeafNode(content?: Partial<PanelContent>): GridNode {
  const id = generateId();
  return {
    id,
    type: "leaf",
    content: {
      id,
      type: "editor",
      tabIds: [],
      activeTabId: "",
      ...content,
    },
  };
}

export function createBranchNode(
  orientation: Orientation,
  first: GridNode,
  second: GridNode,
  splitRatio = 0.5,
): GridNode {
  return {
    id: generateId(),
    type: "branch",
    orientation,
    splitRatio: Math.max(
      CONSTRAINTS.MIN_SPLIT_RATIO,
      Math.min(CONSTRAINTS.MAX_SPLIT_RATIO, splitRatio),
    ),
    children: [first, second],
  };
}

export function findNode(tree: GridNode, nodeId: string): GridNode | null {
  if (tree.id === nodeId) return tree;

  if (tree.type === "branch" && tree.children) {
    for (const child of tree.children) {
      const found = findNode(child, nodeId);
      if (found) return found;
    }
  }

  return null;
}

export function findNodePath(
  tree: GridNode,
  nodeId: string,
  path: number[] = [],
): number[] | null {
  if (tree.id === nodeId) return path;

  if (tree.type === "branch" && tree.children) {
    for (let i = 0; i < tree.children.length; i++) {
      const child = tree.children[i];
      if (child) {
        const found = findNodePath(child, nodeId, [...path, i]);
        if (found) return found;
      }
    }
  }

  return null;
}

export function getNodeByPath(tree: GridNode, path: number[]): GridNode | null {
  let current = tree;

  for (const index of path) {
    if (
      current.type !== "branch" ||
      !current.children ||
      !current.children[index]
    ) {
      return null;
    }
    current = current.children[index];
  }

  return current;
}

export function updateNodeAtPath(
  tree: GridNode,
  path: number[],
  newNode: GridNode,
): GridNode {
  if (path.length === 0) return newNode;

  const [first, ...rest] = path;

  if (
    tree.type !== "branch" ||
    !tree.children ||
    first === undefined ||
    !tree.children[first]
  ) {
    return tree;
  }

  const newChildren = [...tree.children];
  newChildren[first] =
    rest.length === 0
      ? newNode
      : updateNodeAtPath(tree.children[first], rest, newNode);

  return {
    ...tree,
    children: newChildren,
  };
}

export function getTreeDepth(tree: GridNode, depth = 0): number {
  if (tree.type === "leaf") return depth;

  if (tree.children) {
    return Math.max(
      ...tree.children.map((child) => getTreeDepth(child, depth + 1)),
    );
  }

  return depth;
}

export function countPanelsInDirection(
  tree: GridNode,
  orientation: Orientation,
): number {
  if (tree.type === "leaf") return 1;

  if (tree.orientation === orientation && tree.children) {
    return tree.children.reduce(
      (sum, child) => sum + countPanelsInDirection(child, orientation),
      0,
    );
  }

  if (tree.orientation !== orientation && tree.children) {
    return Math.max(
      ...tree.children.map((child) =>
        countPanelsInDirection(child, orientation),
      ),
    );
  }

  return 1;
}

function countVerticalPanelsInColumn(tree: GridNode, targetPanelId: string): number {
  const path = findNodePath(tree, targetPanelId);
  if (!path) return 1;

  // Find the column root by traversing up to the first horizontal parent
  let columnRoot = tree;
  let columnPath: number[] = [];
  
  for (let i = 0; i < path.length; i++) {
    const currentPath = path.slice(0, i);
    const currentNode = getNodeByPath(tree, currentPath);
    
    if (currentNode?.type === "branch" && currentNode.orientation === "horizontal") {
      // Found horizontal parent, the column is the child at path[i]
      columnPath = path.slice(0, i + 1);
      columnRoot = getNodeByPath(tree, columnPath) || tree;
      console.log(`📍 Found column root at path [${columnPath.join(',')}] for panel ${targetPanelId}`);
      break;
    }
  }
  
  // If no horizontal parent found, the entire tree is the column
  if (columnPath.length === 0) {
    columnRoot = tree;
    console.log(`📍 Using entire tree as column root for panel ${targetPanelId}`);
  }
  
  // Count vertical panels in this column
  function countVerticalPanels(node: GridNode): number {
    if (node.type === "leaf") return 1;
    
    if (node.type === "branch" && node.orientation === "vertical") {
      // Vertical split - sum the panels in both children
      const leftCount = node.children?.[0] ? countVerticalPanels(node.children[0]) : 0;
      const rightCount = node.children?.[1] ? countVerticalPanels(node.children[1]) : 0;
      const total = leftCount + rightCount;
      console.log(`🔢 Vertical branch: left=${leftCount}, right=${rightCount}, total=${total}`);
      return total;
    } else if (node.type === "branch" && node.orientation === "horizontal") {
      // Horizontal split within column - take the max of both sides
      const leftCount = node.children?.[0] ? countVerticalPanels(node.children[0]) : 0;
      const rightCount = node.children?.[1] ? countVerticalPanels(node.children[1]) : 0;
      const max = Math.max(leftCount, rightCount);
      console.log(`🔢 Horizontal branch: left=${leftCount}, right=${rightCount}, max=${max}`);
      return max;
    }
    
    return 1;
  }
  
  const count = countVerticalPanels(columnRoot);
  console.log(`📊 Total vertical panels in column for ${targetPanelId}: ${count}`);
  return count;
}

// New function for localized constraint checking
export function getSplitDepthAlongPath(
  tree: GridNode,
  targetPanelId: string,
  splitOrientation: Orientation,
): number {
  if (splitOrientation === "vertical") {
    return countVerticalPanelsInColumn(tree, targetPanelId);
  }
  
  // For horizontal splits, use the original logic
  const path = findNodePath(tree, targetPanelId);
  if (!path) return 0;

  let currentDepth = 0;
  let currentNode = tree;

  for (const index of path) {
    if (
      currentNode.type !== "branch" ||
      !currentNode.children ||
      !currentNode.children[index]
    ) {
      break;
    }
    if (currentNode.orientation === splitOrientation) {
      currentDepth++;
    } else {
      currentDepth = 0;
    }
    currentNode = currentNode.children[index];
  }

  return currentDepth + 1;
}

export function canSplitPanel(
  tree: GridNode,
  targetPanelId: string,
  direction: Direction,
): boolean {
  const splitOrientation: Orientation = ["left", "right"].includes(direction)
    ? "horizontal"
    : "vertical";
  const maxCount =
    splitOrientation === "horizontal"
      ? CONSTRAINTS.MAX_HORIZONTAL_PANELS
      : CONSTRAINTS.MAX_VERTICAL_PANELS;

  // Global tree depth check
  if (getTreeDepth(tree) >= CONSTRAINTS.MAX_TREE_DEPTH) {
    console.log(`❌ Split blocked: Tree depth ${getTreeDepth(tree)} >= ${CONSTRAINTS.MAX_TREE_DEPTH}`);
    return false;
  }

  // Use localized constraint checking per branch
  const currentDepth = getSplitDepthAlongPath(
    tree,
    targetPanelId,
    splitOrientation,
  );
  
  // For vertical splits, currentDepth is the current panel count, adding 1 would exceed if >= maxCount
  // For horizontal splits, currentDepth is the depth that would be created, so <= is correct
  const canSplit = splitOrientation === "vertical" 
    ? currentDepth < maxCount 
    : currentDepth <= maxCount;
    
  console.log(`🔍 Split check for ${direction} (${splitOrientation}):`, {
    targetPanelId,
    currentDepth,
    maxCount,
    wouldExceed: splitOrientation === "vertical" ? currentDepth >= maxCount : currentDepth > maxCount,
    canSplit,
    treeDepth: getTreeDepth(tree)
  });
  
  return canSplit;
}

function countHorizontalColumns(tree: GridNode): number {
  if (tree.type === "leaf") return 1;
  
  if (tree.type === "branch") {
    if (tree.orientation === "horizontal") {
      return (tree.children?.[0] ? countHorizontalColumns(tree.children[0]) : 0) +
             (tree.children?.[1] ? countHorizontalColumns(tree.children[1]) : 0);
    } else {
      return Math.max(
        tree.children?.[0] ? countHorizontalColumns(tree.children[0]) : 0,
        tree.children?.[1] ? countHorizontalColumns(tree.children[1]) : 0
      );
    }
  }
  
  return 1;
}

function redistributeHorizontalRatios(tree: GridNode): GridNode {
  if (tree.type === "leaf") return tree;
  
  if (tree.type === "branch" && tree.children) {
    if (tree.orientation === "horizontal") {
      // For horizontal branches, we want equal column widths
      const totalColumns = countHorizontalColumns(tree);
      const leftColumns = tree.children[0] ? countHorizontalColumns(tree.children[0]) : 0;
      const newRatio = leftColumns / totalColumns;
      
      return {
        ...tree,
        splitRatio: Math.max(0.1, Math.min(0.9, newRatio)),
        children: [
          tree.children[0] ? redistributeHorizontalRatios(tree.children[0]) : tree.children[0],
          tree.children[1] ? redistributeHorizontalRatios(tree.children[1]) : tree.children[1]
        ].filter(Boolean) as GridNode[]
      };
    } else {
      // For vertical branches, keep existing ratios but recurse
      return {
        ...tree,
        children: tree.children.map(child => redistributeHorizontalRatios(child))
      };
    }
  }
  
  return tree;
}

export function splitPanel(
  tree: GridNode,
  targetPanelId: string,
  direction: Direction,
  newPanelContent?: Partial<PanelContent>,
  splitRatio = 0.5,
): GridNode | null {
  const path = findNodePath(tree, targetPanelId);
  if (!path) return null;

  const orientation: Orientation = ["left", "right"].includes(direction)
    ? "horizontal"
    : "vertical";

  if (!canSplitPanel(tree, targetPanelId, direction)) {
    return null;
  }

  const targetNode = getNodeByPath(tree, path);
  if (!targetNode) return null;

  const newPanel = createLeafNode(newPanelContent);

  const isFirstPosition = direction === "left" || direction === "up";
  const newBranch = createBranchNode(
    orientation,
    isFirstPosition ? newPanel : targetNode,
    isFirstPosition ? targetNode : newPanel,
    isFirstPosition ? 1 - splitRatio : splitRatio,
  );

  let updatedTree = updateNodeAtPath(tree, path, newBranch);
  
  // If we're splitting horizontally (creating columns), redistribute widths equally
  if (orientation === "horizontal") {
    updatedTree = redistributeHorizontalRatios(updatedTree);
  }

  return updatedTree;
}

export function closePanel(tree: GridNode, panelId: string): GridNode | null {
  const path = findNodePath(tree, panelId);
  if (!path || path.length === 0) {
    return tree.id === panelId ? null : tree;
  }

  const parentPath = path.slice(0, -1);
  const parent = getNodeByPath(tree, parentPath);

  if (!parent || parent.type !== "branch" || !parent.children) {
    return tree;
  }

  const childIndex = path[path.length - 1];
  if (childIndex === undefined) return tree;

  const siblingIndex = childIndex === 0 ? 1 : 0;
  const sibling = parent.children[siblingIndex];

  if (!sibling) return tree;

  if (parentPath.length === 0) {
    return sibling;
  }

  return updateNodeAtPath(tree, parentPath, sibling);
}

export function resizePanel(
  tree: GridNode,
  path: number[],
  newRatio: number,
): GridNode {
  if (path.length === 0) return tree;

  const parentPath = path.slice(0, -1);
  const parent = getNodeByPath(tree, parentPath);

  if (!parent || parent.type !== "branch") return tree;

  const clampedRatio = Math.max(
    CONSTRAINTS.MIN_SPLIT_RATIO,
    Math.min(CONSTRAINTS.MAX_SPLIT_RATIO, newRatio),
  );

  const updatedParent: GridNode = {
    ...parent,
    splitRatio: clampedRatio,
  };

  if (parentPath.length === 0) {
    return updatedParent;
  }

  return updateNodeAtPath(tree, parentPath, updatedParent);
}

export function getAllPanels(tree: GridNode): PanelContent[] {
  if (tree.type === "leaf" && tree.content) {
    return [tree.content];
  }

  if (tree.type === "branch" && tree.children) {
    return tree.children.flatMap((child) => getAllPanels(child));
  }

  return [];
}

export function getAdjacentPanel(
  tree: GridNode,
  panelId: string,
  direction: Direction,
): string | null {
  const panels = getAllPanels(tree);
  const currentIndex = panels.findIndex((p) => p.id === panelId);

  if (currentIndex === -1) return null;

  let targetIndex = currentIndex;

  switch (direction) {
    case "left":
    case "up":
      targetIndex = Math.max(0, currentIndex - 1);
      break;
    case "right":
    case "down":
      targetIndex = Math.min(panels.length - 1, currentIndex + 1);
      break;
  }

  return panels[targetIndex]?.id || null;
}
