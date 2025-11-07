/**
 * Fuzzy matching utility for autocomplete suggestions
 */

export interface FuzzyMatchResult {
  matches: boolean;
  score: number;
  matchedIndices: number[];
}

/**
 * Fuzzy match a query string against a target string
 * Returns a score where higher is better, or 0 if no match
 *
 * Scoring factors:
 * - Characters matching in order (required)
 * - Early matches score higher
 * - Consecutive matches score higher
 * - Word boundary matches score higher
 * - Case sensitivity bonus
 */
export function fuzzyMatch(
  query: string,
  target: string,
  caseSensitive = false,
): FuzzyMatchResult {
  if (!query) {
    return { matches: true, score: 0, matchedIndices: [] };
  }

  const searchStr = caseSensitive ? query : query.toLowerCase();
  const targetStr = caseSensitive ? target : target.toLowerCase();

  let score = 0;
  let queryIndex = 0;
  let targetIndex = 0;
  let consecutiveMatches = 0;
  const matchedIndices: number[] = [];

  // Track if we're at the start or after a word boundary
  let wasWordBoundary = true;

  while (queryIndex < searchStr.length && targetIndex < targetStr.length) {
    const queryChar = searchStr[queryIndex];
    const targetChar = targetStr[targetIndex];

    // Check if current position is a word boundary
    const isWordBoundary =
      targetIndex === 0 ||
      targetStr[targetIndex - 1] === "_" ||
      targetStr[targetIndex - 1] === "." ||
      targetStr[targetIndex - 1] === "-" ||
      targetStr[targetIndex - 1] === " ";

    if (queryChar === targetChar) {
      // Match found
      matchedIndices.push(targetIndex);
      queryIndex++;

      // Base score for the match
      score += 1;

      // Bonus for consecutive matches
      consecutiveMatches++;
      if (consecutiveMatches > 1) {
        score += consecutiveMatches * 5; // Consecutive bonus
      }

      // Bonus for early matches
      score += Math.max(0, 10 - targetIndex);

      // Bonus for word boundary matches
      if (isWordBoundary || wasWordBoundary) {
        score += 15;
      }

      // Bonus for exact case match
      if (caseSensitive && query[queryIndex - 1] === target[targetIndex]) {
        score += 2;
      }

      wasWordBoundary = false;
    } else {
      // No match, reset consecutive counter
      consecutiveMatches = 0;
      wasWordBoundary = isWordBoundary;
    }

    targetIndex++;
  }

  // Check if we matched all query characters
  const matches = queryIndex === searchStr.length;

  // Penalty for longer targets (prefer shorter matches)
  if (matches) {
    score -= (target.length - query.length) * 0.5;
  }

  return {
    matches,
    score: matches ? Math.max(0, score) : 0,
    matchedIndices,
  };
}

/**
 * Filter and rank items using fuzzy matching
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getLabel: (item: T) => string,
  options: {
    caseSensitive?: boolean;
    limit?: number;
    minScore?: number;
  } = {},
): Array<T & { fuzzyScore: number; fuzzyMatches: number[] }> {
  const { caseSensitive = false, limit = 50, minScore = 0 } = options;

  if (!query.trim()) {
    return items.slice(0, limit).map((item) => ({
      ...item,
      fuzzyScore: 0,
      fuzzyMatches: [],
    }));
  }

  const results = items
    .map((item) => {
      const label = getLabel(item);
      const result = fuzzyMatch(query, label, caseSensitive);
      return {
        item,
        ...result,
      };
    })
    .filter((r) => r.matches && r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score, matchedIndices }) => ({
      ...item,
      fuzzyScore: score,
      fuzzyMatches: matchedIndices,
    }));

  return results;
}

/**
 * Highlight matched characters in a string
 * Returns array of segments with isMatch flag
 */
export function highlightMatches(
  text: string,
  matchedIndices: number[],
): Array<{ text: string; isMatch: boolean }> {
  const segments: Array<{ text: string; isMatch: boolean }> = [];
  const matchSet = new Set(matchedIndices);

  let currentSegment = "";
  let isCurrentMatch = false;

  for (let i = 0; i < text.length; i++) {
    const isMatch = matchSet.has(i);

    if (isMatch !== isCurrentMatch && currentSegment) {
      segments.push({ text: currentSegment, isMatch: isCurrentMatch });
      currentSegment = "";
    }

    const char = text[i];
    if (char !== undefined) {
      currentSegment += char;
    }
    isCurrentMatch = isMatch;
  }

  if (currentSegment) {
    segments.push({ text: currentSegment, isMatch: isCurrentMatch });
  }

  return segments;
}
