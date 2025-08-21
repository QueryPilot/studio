export function getInitialColumnSize(colName: string, rows: any[]) {
  // Calculate minimum size based on column name length
  // Use 8px per character + padding for better readability
  const headerSize = colName.length * 8 + 50; // Extra padding for sort icon and spacing
  const minSize = Math.max(headerSize, 80); // Increased minimum to 80px for better visibility

  // Sample first 10 rows to estimate content width
  const sampleSize = Math.min(rows.length, 10);
  let maxContentLength = 0;

  for (let i = 0; i < sampleSize; i++) {
    const value = rows[i][colName];
    if (value !== null && value !== undefined) {
      const stringValue = String(value);
      maxContentLength = Math.max(maxContentLength, stringValue.length);
    }
  }

  // Calculate content size (7px per character + padding for better readability)
  const contentSize = Math.min(maxContentLength * 7 + 40, 500);

  // Smart defaults based on column name patterns
  const lowerCol = colName.toLowerCase();
  let defaultSize = 150; // Increased default size

  if (lowerCol === "id" || lowerCol.endsWith("_id")) {
    defaultSize = Math.max(100, minSize); // IDs need at least 100px
  } else if (
    lowerCol.includes("date") ||
    lowerCol.includes("time") ||
    lowerCol.includes("_at") ||
    lowerCol.includes("created") ||
    lowerCol.includes("updated")
  ) {
    defaultSize = Math.max(160, minSize);
  } else if (lowerCol.includes("email")) {
    defaultSize = Math.max(200, minSize);
  } else if (lowerCol.includes("name") || lowerCol.includes("title")) {
    defaultSize = Math.max(180, minSize);
  } else if (
    lowerCol.includes("description") ||
    lowerCol.includes("content") ||
    lowerCol.includes("text") ||
    lowerCol.includes("comment") ||
    lowerCol.includes("message")
  ) {
    defaultSize = Math.max(300, minSize);
  } else if (lowerCol.includes("url") || lowerCol.includes("link")) {
    defaultSize = Math.max(250, minSize);
  } else if (
    lowerCol.includes("status") || 
    lowerCol.includes("type") ||
    lowerCol.includes("state")
  ) {
    defaultSize = Math.max(120, minSize);
  } else if (
    lowerCol.includes("price") ||
    lowerCol.includes("amount") ||
    lowerCol.includes("total") ||
    lowerCol.includes("count")
  ) {
    defaultSize = Math.max(120, minSize);
  } else if (lowerCol.includes("phone") || lowerCol.includes("mobile")) {
    defaultSize = Math.max(150, minSize);
  } else if (lowerCol.includes("address")) {
    defaultSize = Math.max(250, minSize);
  } else {
    // For any other column, use a reasonable default
    defaultSize = Math.max(150, minSize);
  }

  // Final size is the maximum of content size and default size
  const finalSize = Math.max(contentSize, defaultSize);

  return {
    size: Math.min(finalSize, 400), // Cap at 400px
    min: minSize, // Dynamic minimum based on column name
    max: 500,
  };
}

export function getSelectionDetailsFromRows(
  selectedRowIds: Set<string>,
  rows: any[],
  selectedRow: any,
) {
  const selectedIds = Array.from(selectedRowIds);
  
  if (selectedIds.length === 0) return null;

  if (selectedIds.length === 1) {
    const firstId = selectedIds[0];
    const row = rows.find((r) => r.id === firstId);
    return row?.original || selectedRow;
  }

  const selectedRows = selectedIds
    .map((id) => rows.find((r) => r.id === id)?.original)
    .filter(Boolean);
  
  if (selectedRows.length === 0) return null;

  const firstRow = selectedRows[0];
  const sharedValues: Record<string, any> = {};

  Object.keys(firstRow).forEach((key) => {
    if (key === "_rowIndex") return;

    const firstValue = firstRow[key];
    const allSame = selectedRows.every((row) => {
      const value = row[key];
      // Use reference equality for objects instead of JSON.stringify
      if (typeof value === "object" && value !== null) {
        return value === firstValue;
      }
      return value === firstValue;
    });

    if (allSame) {
      sharedValues[key] = firstValue;
    } else {
      sharedValues[key] = "(multiple values)";
    }
  });

  return sharedValues;
}