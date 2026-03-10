/**
 * Web Worker for filtering grid rows by search term.
 * Used when nested views have >1000 rows to avoid blocking the UI thread.
 */

export interface GridSearchRequest {
  id: number;
  /** Stringified cell values per row: rows[rowIdx][colIdx] = string */
  rowValues: string[][];
  /** Search term (lowercased by caller) */
  searchTerm: string;
}

export interface GridSearchResponse {
  id: number;
  /** Indices of rows that match the search term */
  matchingIndices: number[];
}

self.onmessage = (event: MessageEvent<GridSearchRequest>) => {
  const { id, rowValues, searchTerm } = event.data;

  if (!searchTerm) {
    const response: GridSearchResponse = {
      id,
      matchingIndices: rowValues.map((_, i) => i),
    };
    self.postMessage(response);
    return;
  }

  const matchingIndices: number[] = [];
  const term = searchTerm.toLowerCase();

  for (let i = 0; i < rowValues.length; i++) {
    const row = rowValues[i];
    if (!row) continue;
    for (const cellValue of row) {
      if (cellValue.toLowerCase().includes(term)) {
        matchingIndices.push(i);
        break;
      }
    }
  }

  const response: GridSearchResponse = { id, matchingIndices };
  self.postMessage(response);
};
