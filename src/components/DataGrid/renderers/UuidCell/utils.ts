import { validate } from "uuid";

export const isValidUuid = (value: string): boolean => {
  return validate(value);
};
