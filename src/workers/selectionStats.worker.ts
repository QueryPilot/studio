/**
 * Web Worker for computing expensive selection statistics (median, unique count).
 * Cheap O(n) stats (sum, avg, min, max) are computed on the main thread.
 * This worker handles O(n log n) median (sort) and O(n) unique (Set) off the main thread.
 */

export interface StatsWorkerRequest {
  id: number;
  /** Decimal string representations of numeric values — for median calculation */
  numericValues: string[];
  /** String representations of all cell values — for unique count */
  allValues: string[];
}

export interface StatsWorkerResponse {
  id: number;
  /** Median value as string (or undefined if no numeric values) */
  median?: string;
  /** Number of unique non-null cell values */
  countUnique: number;
}

/**
 * Compare two numeric strings by value.
 * Handles integers, decimals, and negative numbers without Decimal.js overhead.
 */
function compareNumericStrings(a: string, b: string): number {
  // Handle sign comparison first
  const aNeg = a.startsWith("-");
  const bNeg = b.startsWith("-");
  if (aNeg && !bNeg) return -1;
  if (!aNeg && bNeg) return 1;

  // Both same sign — compare absolute values
  const absA = aNeg ? a.slice(1) : a;
  const absB = bNeg ? b.slice(1) : b;

  const result = compareAbsoluteNumeric(absA, absB);
  // If both negative, reverse the comparison
  return aNeg ? -result : result;
}

function compareAbsoluteNumeric(a: string, b: string): number {
  const [intA = "", fracA = ""] = a.split(".");
  const [intB = "", fracB = ""] = b.split(".");

  // Compare integer parts by length first, then lexicographically
  if (intA.length !== intB.length) return intA.length - intB.length;
  if (intA !== intB) return intA < intB ? -1 : 1;

  // Integer parts equal — compare fractional parts
  // Pad shorter fraction with zeros for comparison
  const maxLen = Math.max(fracA.length, fracB.length);
  const paddedA = fracA.padEnd(maxLen, "0");
  const paddedB = fracB.padEnd(maxLen, "0");
  if (paddedA === paddedB) return 0;
  return paddedA < paddedB ? -1 : 1;
}

function calculateMedian(sortedValues: string[]): string {
  const len = sortedValues.length;
  if (len === 0) return "0";

  const mid = Math.floor(len / 2);

  if (len % 2 === 1) {
    // mid is guaranteed to be in bounds since len >= 1
    return sortedValues[mid] ?? "0";
  }

  // Even length — average of two middle values
  // Use BigInt-safe arithmetic for the average
  const a = sortedValues[mid - 1] ?? "0";
  const b = sortedValues[mid] ?? "0";

  // Parse both as scaled integers to compute exact average
  const [intA = "0", fracA = ""] = a.split(".");
  const [intB = "0", fracB = ""] = b.split(".");

  const maxFrac = Math.max(fracA.length, fracB.length);
  const scaledA = BigInt(intA + fracA.padEnd(maxFrac, "0"));
  const scaledB = BigInt(intB + fracB.padEnd(maxFrac, "0"));

  const sumScaled = scaledA + scaledB;
  const isNeg = sumScaled < 0n;

  // Divide by 2 and place decimal point at maxFrac position
  // sum / 2 in the scaled representation
  const halfScaled = sumScaled / 2n;
  const remainder = sumScaled % 2n;

  const absHalf = (halfScaled < 0n ? -halfScaled : halfScaled).toString();
  const sign = halfScaled < 0n || (halfScaled === 0n && isNeg) ? "-" : "";

  if (maxFrac === 0) {
    // Integer median — if there's a remainder, add .5
    if (remainder !== 0n) {
      return `${sign}${absHalf}.5`;
    }
    return `${sign}${absHalf}`;
  }

  // Place decimal point
  const padded = absHalf.padStart(maxFrac + 1, "0");
  const intPart = padded.slice(0, padded.length - maxFrac) || "0";
  let fracPart = padded.slice(padded.length - maxFrac);

  // Handle remainder from the division
  if (remainder !== 0n) {
    // Add 5 to the next decimal place
    fracPart = fracPart + "5";
  }

  // Trim trailing zeros from fraction
  fracPart = fracPart.replace(/0+$/, "");

  if (fracPart.length === 0) {
    return `${sign}${intPart}`;
  }
  return `${sign}${intPart}.${fracPart}`;
}

self.onmessage = (event: MessageEvent<StatsWorkerRequest>) => {
  const { id, numericValues, allValues } = event.data;

  // Compute unique count
  const uniqueSet = new Set(allValues);
  const countUnique = uniqueSet.size;

  // Compute median
  let median: string | undefined;
  if (numericValues.length > 0) {
    const sorted = [...numericValues].sort(compareNumericStrings);
    median = calculateMedian(sorted);
  }

  const response: StatsWorkerResponse = { id, median, countUnique };
  self.postMessage(response);
};
