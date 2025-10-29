export type ContextValue = string | number | boolean | null | undefined;

export interface ContextKeyDefinition<T = ContextValue> {
  key: string;
  defaultValue: T;
  description?: string;
  owner?: string;
}

export type ContextSnapshot = Map<string, ContextValue>;

export interface ContextKeyExpr {
  evaluate(context: ContextSnapshot): boolean;
  toString(): string;
}

export interface ContextExpressionParser {
  parse(expression: string | undefined): ContextKeyExpr | undefined;
}

export interface ContextChangeEvent {
  key: string;
  oldValue: ContextValue;
  newValue: ContextValue;
}

export type ContextChangeListener = (event: ContextChangeEvent) => void;
