export const normalizeValue = (val: string) => val.trim();

export const isMeaningful = (val: string) => normalizeValue(val).length > 0;

const numberPattern =
  /^([+-]?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?|NaN|Infinity|-Infinity)$/;

export const isValidNumberText = (val: string) => {
  const normalized = normalizeValue(val);
  if (!normalized) return true;
  return numberPattern.test(normalized);
};
