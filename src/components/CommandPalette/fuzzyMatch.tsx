/**
 * Fuzzy matching algorithm for command palette
 * Returns a score from 0-100 based on match quality
 */
export function fuzzyMatch(query: string, target: string): number {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  let score = 0;
  let lastIndex = -1;
  let consecutive = 0;

  for (let i = 0; i < queryLower.length; i++) {
    const char = queryLower[i];
    const index = targetLower.indexOf(char, lastIndex + 1);

    if (index === -1) {
      // Character not found
      return 0;
    }

    // Base score for finding the character
    score += 10;

    // Bonus for consecutive matches
    if (lastIndex !== -1 && index === lastIndex + 1) {
      consecutive++;
      score += consecutive * 5;
    } else {
      consecutive = 0;
    }

    // Bonus for matching at word boundaries
    if (index === 0 || /[^a-zA-Z0-9]/.test(target[index - 1])) {
      score += 15;
    }

    // Bonus for matching capital letters
    if (target[index] === target[index].toUpperCase() && /[A-Z]/.test(target[index])) {
      score += 10;
    }

    // Penalty for distance from last match
    if (lastIndex !== -1) {
      const distance = index - lastIndex - 1;
      score -= distance * 2;
    }

    lastIndex = index;
  }

  // Normalize score to 0-100
  const maxScore = queryLower.length * 35; // Maximum possible score
  return Math.max(0, Math.min(100, Math.round((score / maxScore) * 100)));
}

/**
 * Highlight matching characters in text
 */
export function highlightMatches(query: string, text: string): React.ReactNode[] {
  if (!query) return [text];

  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  const result: React.ReactNode[] = [];
  let lastIndex = -1;
  let textIndex = 0;

  for (let i = 0; i < queryLower.length; i++) {
    const char = queryLower[i];
    const index = textLower.indexOf(char, lastIndex + 1);

    if (index === -1) {
      // No match, return original text
      return [text];
    }

    // Add non-matching text before this match
    if (index > textIndex) {
      result.push(text.substring(textIndex, index));
    }

    // Add matching character with highlight
    result.push(
      <mark key={index} className="bg-primary/20 text-primary font-semibold">
        {text[index]}
      </mark>
    );

    lastIndex = index;
    textIndex = index + 1;
  }

  // Add remaining text
  if (textIndex < text.length) {
    result.push(text.substring(textIndex));
  }

  return result;
}