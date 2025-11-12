import type {
  GridNode,
  Direction,
  Orientation,
  PanelContent,
  WorkbenchConstraints,
} from "@/types/workbench";

export const CONSTRAINTS: WorkbenchConstraints = {
  MAX_COLUMNS: 4, // Maximum 4 columns
  MAX_ROWS: 2,    // Maximum 2 rows
  MIN_PANEL_WIDTH: 200,
  MIN_PANEL_HEIGHT: 150,
  MIN_SPLIT_RATIO: 0.1,
  MAX_SPLIT_RATIO: 0.9,
  // Tree depth removed - using row/column constraints instead
};

export function generateId(): string {
  return `panel-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function createLeafNode(content?: Partial<PanelContent>): GridNode {
  // If content has an ID, use it for both node and content
  // Otherwise generate a new one
  const id = content?.id || generateId();
  
  // Ensure both node.id and content.id are the same
  const finalContent = {
    type: "editor" as const,
    tabIds: [],
    activeTabId: "",
    ...content,
    id, // This MUST be last to ensure consistency
  };
  
  return {
    id,
    type: "leaf",
    content: finalContent,
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

// Tree depth is no longer used - we use row/column constraints instead

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

// Helper to count max vertical panels in any column of the tree
function countVerticalPanelsInTree(node: GridNode): number {
  if (node.type === "leaf") return 1;
  
  if (node.orientation === "vertical") {
    // Vertical split - sum the panels
    const top = node.children?.[0] ? countVerticalPanelsInTree(node.children[0]) : 0;
    const bottom = node.children?.[1] ? countVerticalPanelsInTree(node.children[1]) : 0;
    return top + bottom;
  } else if (node.orientation === "horizontal") {
    // Horizontal split - take the max of both sides
    const left = node.children?.[0] ? countVerticalPanelsInTree(node.children[0]) : 0;
    const right = node.children?.[1] ? countVerticalPanelsInTree(node.children[1]) : 0;
    return Math.max(left, right);
  }
  
  return 1;
}

// Helper to count max horizontal panels in any row of the tree
function countHorizontalPanelsInTree(node: GridNode): number {
  if (node.type === "leaf") return 1;
  
  if (node.orientation === "horizontal") {
    // Horizontal split - sum the panels
    const left = node.children?.[0] ? countHorizontalPanelsInTree(node.children[0]) : 0;
    const right = node.children?.[1] ? countHorizontalPanelsInTree(node.children[1]) : 0;
    return left + right;
  } else if (node.orientation === "vertical") {
    // Vertical split - take the max of both sides
    const top = node.children?.[0] ? countHorizontalPanelsInTree(node.children[0]) : 0;
    const bottom = node.children?.[1] ? countHorizontalPanelsInTree(node.children[1]) : 0;
    return Math.max(top, bottom);
  }
  
  return 1;
}

function countVerticalPanelsInColumn(tree: GridNode, targetPanelId: string): number {
  const path = findNodePath(tree, targetPanelId);
  console.log(`🔍 countVerticalPanelsInColumn: path for ${targetPanelId}:`, path);
  if (path === null) {
    console.warn(`⚠️ Panel ${targetPanelId} not found in tree, returning 1`);
    return 1;
  }

  // If path is empty array, this is the root panel
  if (path.length === 0) {
    console.log(`📍 Target is root panel, counting all vertical panels in tree`);
    // For root panel, count all vertical panels in the tree
    return countVerticalPanelsInTree(tree);
  }

  // Find the FIRST (topmost) horizontal parent by traversing from root
  let columnRoot: GridNode | null = null;

  for (let i = 0; i <= path.length; i++) {
    const currentPath = path.slice(0, i);
    const currentNode = getNodeByPath(tree, currentPath);

    console.log(`  Checking path [${currentPath.join(',')}]:`, {
      type: currentNode?.type,
      orientation: currentNode?.type === 'branch' ? currentNode.orientation : 'N/A'
    });

    if (currentNode?.type === "branch" && currentNode.orientation === "horizontal") {
      // Found horizontal parent! The column is the child we're traversing into
      const childIndex = path[i];
      if (childIndex !== undefined && currentNode.children?.[childIndex]) {
        columnRoot = currentNode.children[childIndex];
        console.log(`📍 Found column root at child[${childIndex}] of horizontal parent at [${currentPath.join(',')}]`);
        break;
      }
    }
  }

  // If no horizontal parent found, the entire tree is the column
  if (!columnRoot) {
    columnRoot = tree;
    console.log(`📍 No horizontal parent found, using entire tree as column`);
  }

  // Count vertical panels in this column
  function countVerticalPanels(node: GridNode): number {
    if (node.type === "leaf") return 1;

    if (node.orientation === "vertical") {
      // Vertical split - sum the panels in both children
      const topCount = node.children?.[0] ? countVerticalPanels(node.children[0]) : 0;
      const bottomCount = node.children?.[1] ? countVerticalPanels(node.children[1]) : 0;
      const total = topCount + bottomCount;
      console.log(`🔢 Vertical branch: top=${topCount}, bottom=${bottomCount}, total=${total}`);
      return total;
    } else if (node.orientation === "horizontal") {
      // Horizontal split within column - take the max of both sides
      const leftCount = node.children?.[0] ? countVerticalPanels(node.children[0]) : 0;
      const rightCount = node.children?.[1] ? countVerticalPanels(node.children[1]) : 0;
      const max = Math.max(leftCount, rightCount);
      console.log(`🔢 Horizontal branch within column: left=${leftCount}, right=${rightCount}, max=${max}`);
      return max;
    }

    return 1;
  }

  const count = countVerticalPanels(columnRoot);
  console.log(`📊 Total vertical panels in column for ${targetPanelId}: ${count}`);
  return count;
}

function countHorizontalPanelsInRow(tree: GridNode, targetPanelId: string): number {
  const path = findNodePath(tree, targetPanelId);
  console.log(`🔍 countHorizontalPanelsInRow: path for ${targetPanelId}:`, path);
  if (path === null) {
    console.warn(`⚠️ Panel ${targetPanelId} not found in tree, returning 1`);
    return 1;
  }
  
  // If path is empty array, this is the root panel
  if (path.length === 0) {
    console.log(`📍 Target is root panel, counting all horizontal panels in tree`);
    // For root panel, count all horizontal panels in the tree
    return countHorizontalPanelsInTree(tree);
  }

  // Find the row root by traversing up to the first vertical parent
  let rowRoot = tree;
  let rowPath: number[] = [];
  
  for (let i = 0; i < path.length; i++) {
    const currentPath = path.slice(0, i);
    const currentNode = getNodeByPath(tree, currentPath);
    
    if (currentNode?.type === "branch" && currentNode.orientation === "vertical") {
      // Found vertical parent, the row is the child at path[i]
      rowPath = path.slice(0, i + 1);
      rowRoot = getNodeByPath(tree, rowPath) || tree;
      console.log(`📍 Found row root at path [${rowPath.join(',')}] for panel ${targetPanelId}`);
      break;
    }
  }
  
  // If no vertical parent found, the entire tree is the row
  if (rowPath.length === 0) {
    rowRoot = tree;
    console.log(`📍 Using entire tree as row root for panel ${targetPanelId}`);
  }
  
  // Count horizontal panels in this row
  function countHorizontalPanels(node: GridNode): number {
    if (node.type === "leaf") return 1;
    
    if (node.orientation === "horizontal") {
      // Horizontal split - sum the panels in both children
      const leftCount = node.children?.[0] ? countHorizontalPanels(node.children[0]) : 0;
      const rightCount = node.children?.[1] ? countHorizontalPanels(node.children[1]) : 0;
      const total = leftCount + rightCount;
      console.log(`🔢 Horizontal branch: left=${leftCount}, right=${rightCount}, total=${total}`);
      return total;
    } else if (node.orientation === "vertical") {
      // Vertical split within row - take the max of both sides
      const topCount = node.children?.[0] ? countHorizontalPanels(node.children[0]) : 0;
      const bottomCount = node.children?.[1] ? countHorizontalPanels(node.children[1]) : 0;
      const max = Math.max(topCount, bottomCount);
      console.log(`🔢 Vertical branch in row: top=${topCount}, bottom=${bottomCount}, max=${max}`);
      return max;
    }
    
    return 1;
  }
  
  const count = countHorizontalPanels(rowRoot);
  console.log(`📊 Total horizontal panels in row for ${targetPanelId}: ${count}`);
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
  
  // For horizontal splits, count actual panels in the row
  return countHorizontalPanelsInRow(tree, targetPanelId);
}

export function canSplitPanel(
  tree: GridNode,
  targetPanelId: string,
  direction: Direction,
): boolean {
  console.log(`🔍 canSplitPanel called for ${targetPanelId} direction: ${direction}`);
  
  const splitOrientation: Orientation = ["left", "right"].includes(direction)
    ? "horizontal"
    : "vertical";

  if (splitOrientation === "horizontal") {
    // Check column constraint
    const currentColumns = countHorizontalPanelsInRow(tree, targetPanelId);
    const canSplit = currentColumns < CONSTRAINTS.MAX_COLUMNS;
    
    console.log(`📊 Column check: ${currentColumns} columns in row, max: ${CONSTRAINTS.MAX_COLUMNS}, can split: ${canSplit}`);
    
    if (!canSplit) {
      console.log(`❌ Cannot split: Already at max ${CONSTRAINTS.MAX_COLUMNS} columns in this row`);
    }
    
    return canSplit;
  } else {
    // Check row constraint
    const currentRows = countVerticalPanelsInColumn(tree, targetPanelId);
    const canSplit = currentRows < CONSTRAINTS.MAX_ROWS;
    
    console.log(`📊 Row check: ${currentRows} rows in column, max: ${CONSTRAINTS.MAX_ROWS}, can split: ${canSplit}`);
    
    if (!canSplit) {
      console.log(`❌ Cannot split: Already at max ${CONSTRAINTS.MAX_ROWS} rows in this column`);
    }
    
    return canSplit;
  }
}

function countHorizontalColumns(tree: GridNode): number {
  if (tree.type === "leaf") return 1;

  // Type is narrowed to "branch" after the early return above
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

function countVerticalRows(tree: GridNode): number {
  if (tree.type === "leaf") return 1;

  // Type is narrowed to "branch" after the early return above
  if (tree.orientation === "vertical") {
    return (tree.children?.[0] ? countVerticalRows(tree.children[0]) : 0) +
           (tree.children?.[1] ? countVerticalRows(tree.children[1]) : 0);
  } else {
    return Math.max(
      tree.children?.[0] ? countVerticalRows(tree.children[0]) : 0,
      tree.children?.[1] ? countVerticalRows(tree.children[1]) : 0
    );
  }
}

function redistributeHorizontalRatios(tree: GridNode, depth = 0): GridNode {
  const indent = "  ".repeat(depth);

  if (tree.type === "leaf") {
    console.log(`${indent}🍃 Leaf node, no redistribution needed`);
    return tree;
  }

  // Type is narrowed to "branch" after the early return above
  if (tree.children) {
    if (tree.orientation === "horizontal") {
      // For horizontal branches, we want equal column widths
      const totalColumns = countHorizontalColumns(tree);
      const leftColumns = tree.children[0] ? countHorizontalColumns(tree.children[0]) : 0;
      const rightColumns = tree.children[1] ? countHorizontalColumns(tree.children[1]) : 0;
      const newRatio = leftColumns / totalColumns;
      const clampedRatio = Math.max(0.1, Math.min(0.9, newRatio));

      console.log(`${indent}➡️ Horizontal branch redistribution:`, {
        id: tree.id.substring(0, 8),
        totalColumns,
        leftColumns,
        rightColumns,
        oldRatio: tree.splitRatio,
        newRatio,
        clampedRatio,
      });

      return {
        ...tree,
        splitRatio: clampedRatio,
        children: [
          tree.children[0] ? redistributeHorizontalRatios(tree.children[0], depth + 1) : tree.children[0],
          tree.children[1] ? redistributeHorizontalRatios(tree.children[1], depth + 1) : tree.children[1]
        ].filter(Boolean) as GridNode[]
      };
    } else {
      // For vertical branches, keep existing ratios but recurse
      console.log(`${indent}↕️ Vertical branch, keeping ratio ${tree.splitRatio}, recursing`);
      return {
        ...tree,
        children: tree.children.map(child => redistributeHorizontalRatios(child, depth + 1))
      };
    }
  }

  return tree;
}

function redistributeVerticalRatios(tree: GridNode): GridNode {
  if (tree.type === "leaf") return tree;

  // Type is narrowed to "branch" after the early return above
  if (tree.children) {
    if (tree.orientation === "vertical") {
      // For vertical branches, we want equal row heights
      const totalRows = countVerticalRows(tree);
      const topRows = tree.children[0] ? countVerticalRows(tree.children[0]) : 0;
      const newRatio = topRows / totalRows;

      return {
        ...tree,
        splitRatio: Math.max(0.1, Math.min(0.9, newRatio)),
        children: [
          tree.children[0] ? redistributeVerticalRatios(tree.children[0]) : tree.children[0],
          tree.children[1] ? redistributeVerticalRatios(tree.children[1]) : tree.children[1]
        ].filter(Boolean) as GridNode[]
      };
    } else {
      // For horizontal branches, keep existing ratios but recurse
      return {
        ...tree,
        children: tree.children.map(child => redistributeVerticalRatios(child))
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
): { tree: GridNode; newPanelId: string } | null {
  console.log('🔍 splitPanel called:', { targetPanelId, direction, tree });

  const path = findNodePath(tree, targetPanelId);
  if (path === null) {
    console.error('❌ splitPanel: findNodePath returned null for', targetPanelId);
    return null;
  }
  console.log('✅ Found path:', path);

  const orientation: Orientation = ["left", "right"].includes(direction)
    ? "horizontal"
    : "vertical";

  if (!canSplitPanel(tree, targetPanelId, direction)) {
    console.error('❌ splitPanel: canSplitPanel returned false');
    return null;
  }
  console.log('✅ Can split panel');

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

  console.log("🔧 BEFORE redistribution, root splitRatio:", updatedTree.type === "branch" ? updatedTree.splitRatio : "N/A");

  // Redistribute sizes equally based on split orientation
  if (orientation === "horizontal") {
    // For horizontal splits, ensure equal column widths
    updatedTree = redistributeHorizontalRatios(updatedTree);
  } else {
    // For vertical splits, ensure equal row heights
    updatedTree = redistributeVerticalRatios(updatedTree);
  }

  console.log("✅ AFTER redistribution, root splitRatio:", updatedTree.type === "branch" ? updatedTree.splitRatio : "N/A");

  // Log all splitRatios in the tree
  function logAllRatios(node: GridNode, prefix = "Root"): void {
    if (node.type === "branch") {
      console.log(`  ${prefix}: splitRatio=${node.splitRatio}, orientation=${node.orientation}`);
      if (node.children?.[0]) logAllRatios(node.children[0], `${prefix}.left`);
      if (node.children?.[1]) logAllRatios(node.children[1], `${prefix}.right`);
    } else {
      console.log(`  ${prefix}: LEAF panel ${node.id.substring(0, 10)}`);
    }
  }
  console.log("🌳 Complete tree structure with ratios:");
  logAllRatios(updatedTree);

  return { tree: updatedTree, newPanelId: newPanel.id };
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
