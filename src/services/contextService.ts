import { v4 as uuid } from 'uuid';

import {
  ContextChangeEvent,
  ContextChangeListener,
  ContextExpressionParser,
  ContextKeyDefinition,
  ContextKeyExpr,
  ContextSnapshot,
  ContextValue,
} from '@/types/context';

type ScopeId = string;

interface ContextScope {
  id: ScopeId;
  parent?: ScopeId;
  values: Map<string, ContextValue>;
}

interface EvaluateOptions {
  scopes?: ScopeId[];
}

type Evaluator = (context: ContextSnapshot) => boolean;

interface OperandEvaluator {
  evalValue(context: ContextSnapshot): unknown;
  evalBool(context: ContextSnapshot): boolean;
  describe(): string;
}

type TokenType =
  | 'identifier'
  | 'string'
  | 'number'
  | 'boolean'
  | 'regex'
  | 'operator'
  | 'paren'
  | 'bracket'
  | 'comma'
  | 'eof';

interface Token {
  type: TokenType;
  value?: string;
}

class CompiledContextExpr implements ContextKeyExpr {
  constructor(
    private readonly expression: string,
    private readonly evaluator: Evaluator
  ) {}

  evaluate(context: ContextSnapshot): boolean {
    return this.evaluator(context);
  }

  toString(): string {
    return this.expression;
  }
}

class ExpressionParser implements ContextExpressionParser {
  private tokens: Token[] = [];
  private position = 0;

  parse(expression: string | undefined): ContextKeyExpr | undefined {
    if (!expression) {
      return undefined;
    }

    this.tokens = this.tokenize(expression);
    this.position = 0;
    const evaluator = this.parseOr();
    this.expect('eof');

    return new CompiledContextExpr(expression, evaluator);
  }

  private tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let index = 0;

    while (index < input.length) {
      const remainder = input.slice(index);

      if (/^\s+/.test(remainder)) {
        const [match] = remainder.match(/^\s+/) ?? [''];
        index += match.length;
        continue;
      }

      const next = remainder[0];

      if (next === '(' || next === ')') {
        tokens.push({ type: 'paren', value: next });
        index += 1;
        continue;
      }

      if (next === '[' || next === ']') {
        tokens.push({ type: 'bracket', value: next });
        index += 1;
        continue;
      }

      if (next === ',') {
        tokens.push({ type: 'comma', value: next });
        index += 1;
        continue;
      }

      if (remainder.startsWith('&&') || remainder.startsWith('||')) {
        tokens.push({ type: 'operator', value: remainder.slice(0, 2) });
        index += 2;
        continue;
      }

      if (remainder.startsWith('==') || remainder.startsWith('!=') || remainder.startsWith('=~')) {
        tokens.push({ type: 'operator', value: remainder.slice(0, 2) });
        index += 2;
        continue;
      }

      if (remainder.startsWith('!')) {
        tokens.push({ type: 'operator', value: '!' });
        index += 1;
        continue;
      }

      if (/^in\b/.test(remainder)) {
        tokens.push({ type: 'operator', value: 'in' });
        index += 2;
        continue;
      }

      if (next === '"' || next === "'") {
        let value = '';
        let consumed = 1;
        let escaped = false;

        while (consumed < remainder.length) {
          const char = remainder[consumed];
          if (escaped) {
            value += char;
            escaped = false;
          } else if (char === '\\') {
            escaped = true;
          } else if (char === next) {
            break;
          } else {
            value += char;
          }
          consumed += 1;
        }

        tokens.push({ type: 'string', value });
        index += consumed + 1;
        continue;
      }

      if (next === '/') {
        let pattern = '';
        let consumed = 1;
        let escaped = false;

        while (consumed < remainder.length) {
          const char = remainder[consumed];
          if (escaped) {
            pattern += char;
            escaped = false;
          } else if (char === '\\') {
            escaped = true;
          } else if (char === '/') {
            break;
          } else {
            pattern += char;
          }
          consumed += 1;
        }

        let flags = '';
        consumed += 1;
        while (consumed < remainder.length && /[gimsuy]/.test(remainder[consumed])) {
          flags += remainder[consumed];
          consumed += 1;
        }

        tokens.push({ type: 'regex', value: `/${pattern}/${flags}` });
        index += consumed;
        continue;
      }

      if (/^[0-9]/.test(remainder)) {
        const [match] = remainder.match(/^[0-9]+(\.[0-9]+)?/) ?? [''];
        tokens.push({ type: 'number', value: match });
        index += match.length;
        continue;
      }

      if (/^(true|false)\b/.test(remainder)) {
        const value = remainder.startsWith('true') ? 'true' : 'false';
        tokens.push({ type: 'boolean', value });
        index += value.length;
        continue;
      }

      const identifierMatch = remainder.match(/^[a-zA-Z0-9_.-]+/);
      if (identifierMatch) {
        tokens.push({ type: 'identifier', value: identifierMatch[0] });
        index += identifierMatch[0].length;
        continue;
      }

      throw new Error(`Unexpected token in context expression near "${remainder}"`);
    }

    tokens.push({ type: 'eof' });
    return tokens;
  }

  private parseOr(): Evaluator {
    let left = this.parseAnd();
    while (this.matchOperator('||')) {
      const right = this.parseAnd();
      const prevLeft = left;
      left = (context) => prevLeft(context) || right(context);
    }

    return left;
  }

  private parseAnd(): Evaluator {
    let left = this.parseUnary();
    while (this.matchOperator('&&')) {
      const right = this.parseUnary();
      const prevLeft = left;
      left = (context) => prevLeft(context) && right(context);
    }

    return left;
  }

  private parseUnary(): Evaluator {
    if (this.matchOperator('!')) {
      const operand = this.parseUnary();
      return (context) => !operand(context);
    }

    return this.parseComparison();
  }

  private parseComparison(): Evaluator {
    const left = this.parseOperand();

    if (this.matchOperator('==')) {
      const right = this.parseOperand();
      return (context) => this.compare(left.evalValue(context), right.evalValue(context)) === 0;
    }

    if (this.matchOperator('!=')) {
      const right = this.parseOperand();
      return (context) => this.compare(left.evalValue(context), right.evalValue(context)) !== 0;
    }

    if (this.matchOperator('in')) {
      const valueProvider = this.parseInValues();
      return (context) => {
        const collection = valueProvider(context);
        return collection.map(String).includes(String(left.evalValue(context)));
      };
    }

    if (this.matchOperator('=~')) {
      const pattern = this.parseRegexOperand();
      return (context) => pattern.test(String(left.evalValue(context)));
    }

    return (context) => left.evalBool(context);
  }

  private parseOperand(): OperandEvaluator {
    if (this.matchParen('(')) {
      const evaluator = this.parseOr();
      this.expectParen(')');
      return {
        evalValue: (context) => evaluator(context),
        evalBool: (context) => !!evaluator(context),
        describe: () => '(expr)',
      };
    }

    const token = this.advance();
    switch (token.type) {
      case 'identifier':
        return {
          evalValue: (context) => context.get(token.value ?? '') ?? false,
          evalBool: (context) => this.isTruthy(context.get(token.value ?? '')),
          describe: () => token.value ?? '',
        };
      case 'string':
        return {
          evalValue: () => token.value ?? '',
          evalBool: () => this.isTruthy(token.value),
          describe: () => `"${token.value ?? ''}"`,
        };
      case 'number':
        return {
          evalValue: () => Number(token.value),
          evalBool: () => !!Number(token.value),
          describe: () => token.value ?? '0',
        };
      case 'boolean':
        return {
          evalValue: () => (token.value === 'true'),
          evalBool: () => token.value === 'true',
          describe: () => token.value ?? 'false',
        };
      default:
        throw new Error(`Unexpected token "${token.value ?? token.type}" in expression`);
    }
  }

  private parseInValues(): (context: ContextSnapshot) => string[] {
    if (this.matchBracket('[')) {
      const values: string[] = [];
      if (this.checkBracket(']')) {
        this.expectBracket(']');
        return () => values;
      }

      do {
        const token = this.advance();
        if (token.type === 'string' || token.type === 'identifier') {
          values.push(String(token.value));
        } else if (token.type === 'number') {
          values.push(String(Number(token.value)));
        } else if (token.type === 'boolean') {
          values.push(token.value === 'true' ? 'true' : 'false');
        } else {
          throw new Error(`Unsupported value in "in" expression: ${token.value ?? token.type}`);
        }
      } while (this.matchComma());

      this.expectBracket(']');
      return () => values;
    }

    const operand = this.parseOperand();
    return (context) => {
      const value = operand.evalValue(context);
      if (Array.isArray(value)) {
        return value.map(String);
      }
      if (typeof value === 'string') {
        return value.split(',').map((part) => part.trim()).filter(Boolean);
      }
      if (value === undefined || value === null) {
        return [];
      }

      return [String(value)];
    };
  }

  private parseRegexOperand(): RegExp {
    const token = this.advance();
    if (token.type !== 'regex' || !token.value) {
      throw new Error('Expected regex literal');
    }

    const lastSlash = token.value.lastIndexOf('/');
    const pattern = token.value.slice(1, lastSlash);
    const flags = token.value.slice(lastSlash + 1);
    return new RegExp(pattern, flags);
  }

  private compare(left: unknown, right: unknown): number {
    if (left === right) {
      return 0;
    }

    if (typeof left === 'number' && typeof right === 'number') {
      return left - right;
    }

    return String(left) === String(right) ? 0 : -1;
  }

  private isTruthy(value: unknown): boolean {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return !!value;
  }

  private matchOperator(value: string): boolean {
    if (this.check('operator') && this.peek().value === value) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchParen(value: string): boolean {
    if (this.check('paren') && this.peek().value === value) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchBracket(value: string): boolean {
    if (this.check('bracket') && this.peek().value === value) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchComma(): boolean {
    if (this.check('comma')) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType): void {
    const token = this.advance();
    if (token.type !== type) {
      throw new Error(`Expected ${type} but found ${token.type}`);
    }
  }

  private expectParen(value: string): void {
    const token = this.advance();
    if (token.type !== 'paren' || token.value !== value) {
      throw new Error(`Expected "${value}"`);
    }
  }

  private expectBracket(value: string): void {
    const token = this.advance();
    if (token.type !== 'bracket' || token.value !== value) {
      throw new Error(`Expected "${value}"`);
    }
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private checkBracket(value: string): boolean {
    const token = this.peek();
    return token.type === 'bracket' && token.value === value;
  }

  private peek(): Token {
    return this.tokens[this.position] ?? { type: 'eof' };
  }

  private advance(): Token {
    if (this.position < this.tokens.length) {
      this.position += 1;
    }
    return this.tokens[this.position - 1] ?? { type: 'eof' };
  }
}

export class ContextService {
  private readonly definitions = new Map<string, ContextKeyDefinition>();
  private readonly globalValues = new Map<string, ContextValue>();
  private readonly scopes = new Map<ScopeId, ContextScope>();
  private readonly expressionCache = new Map<string, ContextKeyExpr>();
  private readonly listeners = new Set<ContextChangeListener>();
  private readonly parser: ContextExpressionParser = new ExpressionParser();
  private activeScopes: ScopeId[] = [];

  defineKey<T = ContextValue>(definition: ContextKeyDefinition<T>): void {
    if (this.definitions.has(definition.key)) {
      return;
    }

    this.definitions.set(definition.key, definition);
    this.globalValues.set(definition.key, definition.defaultValue ?? undefined);
  }

  defineMany(definitions: ContextKeyDefinition[]): void {
    for (const definition of definitions) {
      this.defineKey(definition);
    }
  }

  setValue(key: string, value: ContextValue, scopeId?: ScopeId): void {
    const target = scopeId ? this.ensureScope(scopeId).values : this.globalValues;
    const previous = target.get(key);

    if (previous === value) {
      return;
    }

    if (value === undefined) {
      target.delete(key);
    } else {
      target.set(key, value);
    }

    this.emitChange({ key, oldValue: previous, newValue: value });
  }

  getValue<T = ContextValue>(key: string, scopes?: ScopeId[]): T | undefined {
    const chain = this.getScopeChain(scopes);

    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const scope = this.scopes.get(chain[index]);
      const value = scope?.values.get(key);
      if (value !== undefined) {
        return value as T;
      }
    }

    if (this.globalValues.has(key)) {
      return this.globalValues.get(key) as T;
    }

    return undefined;
  }

  reset(key: string): void {
    const definition = this.definitions.get(key);
    const oldValue = this.globalValues.get(key);
    const nextValue = definition?.defaultValue;
    this.globalValues.set(key, nextValue);

    this.emitChange({
      key,
      oldValue,
      newValue: nextValue,
    });
  }

  evaluate(expression: string | undefined, options?: EvaluateOptions): boolean {
    if (!expression) {
      return true;
    }

    const compiled = this.parseExpression(expression);
    if (!compiled) {
      return true;
    }

    const snapshot = this.snapshot(options?.scopes);
    return compiled.evaluate(snapshot);
  }

  parseExpression(expression: string | undefined): ContextKeyExpr | undefined {
    if (!expression) {
      return undefined;
    }

    const cached = this.expressionCache.get(expression);
    if (cached) {
      return cached;
    }

    const compiled = this.parser.parse(expression);
    if (compiled) {
      this.expressionCache.set(expression, compiled);
    }

    return compiled;
  }

  snapshot(scopes?: ScopeId[]): ContextSnapshot {
    const snapshot: ContextSnapshot = new Map();

    for (const [key, value] of this.globalValues.entries()) {
      snapshot.set(key, value);
    }

    const chain = this.getScopeChain(scopes);
    for (const scopeId of chain) {
      const scope = this.scopes.get(scopeId);
      if (!scope) {
        continue;
      }

      for (const [key, value] of scope.values.entries()) {
        snapshot.set(key, value);
      }
    }

    return snapshot;
  }

  createScope(parent?: ScopeId, scopeId?: ScopeId): ScopeId {
    const id = scopeId ?? uuid();
    if (this.scopes.has(id)) {
      throw new Error(`Context scope ${id} already exists`);
    }

    this.scopes.set(id, {
      id,
      parent,
      values: new Map<string, ContextValue>(),
    });

    return id;
  }

  disposeScope(scopeId: ScopeId): void {
    this.scopes.delete(scopeId);
    this.activeScopes = this.activeScopes.filter((id) => id !== scopeId);
  }

  enterScope(scopeId: ScopeId): void {
    if (!this.scopes.has(scopeId)) {
      this.createScope(undefined, scopeId);
    }

    if (!this.activeScopes.includes(scopeId)) {
      this.activeScopes.push(scopeId);
    }
  }

  exitScope(scopeId: ScopeId): void {
    this.activeScopes = this.activeScopes.filter((id) => id !== scopeId);
  }

  withScope<T>(scopeId: ScopeId, fn: () => T): T {
    this.enterScope(scopeId);
    try {
      return fn();
    } finally {
      this.exitScope(scopeId);
    }
  }

  onDidChange(listener: ContextChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private ensureScope(scopeId: ScopeId): ContextScope {
    let scope = this.scopes.get(scopeId);
    if (!scope) {
      scope = {
        id: scopeId,
        values: new Map(),
      };
      this.scopes.set(scopeId, scope);
    }
    return scope;
  }

  private getScopeChain(scopes?: ScopeId[]): ScopeId[] {
    if (scopes && scopes.length > 0) {
      return scopes;
    }
    return this.activeScopes;
  }

  private emitChange(event: ContextChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const contextService = new ContextService();
