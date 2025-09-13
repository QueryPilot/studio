import type { KeyboardContext } from './types';

type Expression =
  | { type: 'and'; left: Expression; right: Expression }
  | { type: 'or'; left: Expression; right: Expression }
  | { type: 'not'; operand: Expression }
  | { type: 'equals'; left: string; right: string }
  | { type: 'notEquals'; left: string; right: string }
  | { type: 'variable'; name: string }
  | { type: 'literal'; value: string | boolean };

export class ContextEvaluator {
  private cache: Map<string, WeakMap<KeyboardContext, boolean>> = new Map();

  evaluate(expression: string | undefined, context: KeyboardContext): boolean {
    if (!expression) return true; // No condition means always active

    // Check cache
    if (this.cache.has(expression)) {
      const contextCache = this.cache.get(expression)!;
      if (contextCache.has(context)) {
        return contextCache.get(context)!;
      }
    } else {
      this.cache.set(expression, new WeakMap());
    }

    // Parse and evaluate
    try {
      const ast = this.parse(expression);
      const result = this.evaluateExpression(ast, context);

      // Cache result
      this.cache.get(expression)!.set(context, result);
      return result;
    } catch (error) {
      console.warn(`Failed to evaluate expression "${expression}":`, error);
      return false;
    }
  }

  private parse(expression: string): Expression {
    // Simplified parser for common patterns
    expression = expression.trim();

    // Handle OR (||)
    const orIndex = this.findOperator(expression, '||');
    if (orIndex !== -1) {
      return {
        type: 'or',
        left: this.parse(expression.substring(0, orIndex)),
        right: this.parse(expression.substring(orIndex + 2)),
      };
    }

    // Handle AND (&&)
    const andIndex = this.findOperator(expression, '&&');
    if (andIndex !== -1) {
      return {
        type: 'and',
        left: this.parse(expression.substring(0, andIndex)),
        right: this.parse(expression.substring(andIndex + 2)),
      };
    }

    // Handle NOT (!)
    if (expression.startsWith('!')) {
      return {
        type: 'not',
        operand: this.parse(expression.substring(1).trim()),
      };
    }

    // Handle EQUALS (==)
    const eqIndex = this.findOperator(expression, '==');
    if (eqIndex !== -1) {
      return {
        type: 'equals',
        left: expression.substring(0, eqIndex).trim(),
        right: expression.substring(eqIndex + 2).trim().replace(/['"]/g, ''),
      };
    }

    // Handle NOT EQUALS (!=)
    const neqIndex = this.findOperator(expression, '!=');
    if (neqIndex !== -1) {
      return {
        type: 'notEquals',
        left: expression.substring(0, neqIndex).trim(),
        right: expression.substring(neqIndex + 2).trim().replace(/['"]/g, ''),
      };
    }

    // Handle parentheses
    if (expression.startsWith('(') && expression.endsWith(')')) {
      return this.parse(expression.substring(1, expression.length - 1));
    }

    // Variable or literal
    if (expression === 'true') {
      return { type: 'literal', value: true };
    }
    if (expression === 'false') {
      return { type: 'literal', value: false };
    }

    // Treat as variable
    return { type: 'variable', name: expression };
  }

  private findOperator(expression: string, operator: string): number {
    let depth = 0;
    for (let i = 0; i < expression.length - operator.length + 1; i++) {
      if (expression[i] === '(') depth++;
      else if (expression[i] === ')') depth--;
      else if (depth === 0 && expression.substring(i, i + operator.length) === operator) {
        return i;
      }
    }
    return -1;
  }

  private evaluateExpression(expr: Expression, context: KeyboardContext): boolean {
    switch (expr.type) {
      case 'and':
        return (
          this.evaluateExpression(expr.left, context) &&
          this.evaluateExpression(expr.right, context)
        );

      case 'or':
        return (
          this.evaluateExpression(expr.left, context) ||
          this.evaluateExpression(expr.right, context)
        );

      case 'not':
        return !this.evaluateExpression(expr.operand, context);

      case 'equals': {
        const leftValue = this.resolveValue(expr.left, context);
        const rightValue = expr.right;
        return String(leftValue) === String(rightValue);
      }

      case 'notEquals': {
        const leftValue = this.resolveValue(expr.left, context);
        const rightValue = expr.right;
        return String(leftValue) !== String(rightValue);
      }

      case 'variable':
        return this.resolveVariable(expr.name, context);

      case 'literal':
        return Boolean(expr.value);

      default:
        return false;
    }
  }

  private resolveValue(path: string, context: KeyboardContext): any {
    // Handle nested properties (e.g., "activeView.type")
    const parts = path.split('.');
    let value: any = context;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private resolveVariable(name: string, context: KeyboardContext): boolean {
    const value = this.resolveValue(name, context);

    // Special handling for common patterns
    if (name.endsWith('Focus')) {
      // e.g., queryEditorFocus, tableViewFocus
      return Boolean(value);
    }

    if (name.endsWith('Visible')) {
      // e.g., leftSidebarVisible, rightSidebarVisible
      return Boolean(value);
    }

    if (name === 'hasQuery') {
      // Check if there's a non-empty query
      return Boolean(context.query?.trim());
    }

    // Default: convert to boolean
    return Boolean(value);
  }

  clearCache(): void {
    this.cache.clear();
  }
}