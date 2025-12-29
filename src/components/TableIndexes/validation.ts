export interface IndexValidationResult {
  valid: boolean;
  error?: string;
}

export function validateIndexName(
  name: string,
  existingNames: string[],
  currentName?: string,
): IndexValidationResult {
  const trimmed = name.trim();

  if (!trimmed) {
    return { valid: false, error: "Index name is required" };
  }

  if (trimmed.length > 63) {
    return { valid: false, error: "Index name too long (max 63 characters)" };
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return {
      valid: false,
      error:
        "Index name must start with letter/underscore and contain only letters, numbers, underscores",
    };
  }

  const lowerName = trimmed.toLowerCase();
  const isDuplicate = existingNames.some(
    (existing) =>
      existing.toLowerCase() === lowerName &&
      existing.toLowerCase() !== currentName?.toLowerCase(),
  );

  if (isDuplicate) {
    return { valid: false, error: "Index name already exists" };
  }

  return { valid: true };
}

export function validateIndexColumns(columns: string[]): IndexValidationResult {
  if (columns.length === 0) {
    return { valid: false, error: "At least one column is required" };
  }

  return { valid: true };
}

export function validateIndexDefinition(
  name: string,
  columns: string[],
  existingNames: string[],
  currentName?: string,
): IndexValidationResult {
  const nameResult = validateIndexName(name, existingNames, currentName);
  if (!nameResult.valid) return nameResult;

  const columnsResult = validateIndexColumns(columns);
  if (!columnsResult.valid) return columnsResult;

  return { valid: true };
}
