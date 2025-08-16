export function getInitialColumnSize(colName: string, rows: any[]) {
  const headerSize = colName.length * 8 + 24;
  const minSize = Math.max(headerSize, 100);

  const sampleSize = Math.min(rows.length, 10);
  let maxContentLength = 0;

  for (let i = 0; i < sampleSize; i++) {
    const value = rows[i][colName];
    if (value !== null && value !== undefined) {
      const stringValue = String(value);
      maxContentLength = Math.max(maxContentLength, stringValue.length);
    }
  }

  const contentSize = Math.min(maxContentLength * 6 + 24, 400);

  const lowerCol = colName.toLowerCase();
  let defaultSize = 120;

  if (lowerCol === "id" || lowerCol.endsWith("_id")) defaultSize = 60;
  else if (
    lowerCol.includes("date") ||
    lowerCol.includes("time") ||
    lowerCol.includes("_at")
  )
    defaultSize = 140;
  else if (lowerCol.includes("email")) defaultSize = 180;
  else if (lowerCol.includes("name") || lowerCol.includes("title"))
    defaultSize = 150;
  else if (
    lowerCol.includes("description") ||
    lowerCol.includes("content") ||
    lowerCol.includes("text")
  )
    defaultSize = 250;
  else if (lowerCol.includes("url") || lowerCol.includes("link"))
    defaultSize = 200;
  else if (lowerCol.includes("status") || lowerCol.includes("type"))
    defaultSize = 100;

  const finalSize = Math.max(minSize, contentSize, defaultSize);

  return {
    size: Math.min(finalSize, 400),
    min: minSize,
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