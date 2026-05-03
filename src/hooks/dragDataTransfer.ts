type DataTransferTypes = DataTransfer["types"] & {
  contains?: (type: string) => boolean;
  includes?: (type: string) => boolean;
  item?: (index: number) => string | null;
};

export function dataTransferHasType(
  dataTransfer: DataTransfer,
  type: string,
): boolean {
  const types = dataTransfer.types as DataTransferTypes;

  if (typeof types.includes === "function") {
    return types.includes(type);
  }

  if (typeof types.contains === "function") {
    return types.contains(type);
  }

  for (let i = 0; i < types.length; i++) {
    const value =
      typeof types.item === "function"
        ? types.item(i)
        : (types as ArrayLike<string>)[i];
    if (value === type) return true;
  }

  return false;
}

export function dataTransferHasAnyType(
  dataTransfer: DataTransfer,
  types: readonly string[],
): boolean {
  return types.some((type) => dataTransferHasType(dataTransfer, type));
}
