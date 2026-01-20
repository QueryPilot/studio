# MongoDB IntelliShell Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a MongoDB shell-style query editor with autocomplete, syntax validation, method chaining, and parameter hints.

**Architecture:** Parser-based approach (no eval) using Apache-2.0 MongoDB packages. Extend JavaScript CodeMirror mode with MongoDB-specific completions and linting. Mode toggle (Shell/JSON) in toolbar.

**Tech Stack:** `@mongodb-js/shell-bson-parser`, `mongodb-query-parser`, `@mongodb-js/mongodb-constants`, CodeMirror 6

---

## Task 1: Install MongoDB Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install packages**

Run:
```bash
pnpm add @mongodb-js/shell-bson-parser mongodb-query-parser @mongodb-js/mongodb-constants
```

**Step 2: Verify installation**

Run:
```bash
pnpm list @mongodb-js/shell-bson-parser mongodb-query-parser @mongodb-js/mongodb-constants
```

Expected: All three packages listed with versions

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add MongoDB shell parsing dependencies"
```

---

## Task 2: Create Parser Types

**Files:**
- Create: `src/components/MongoQueryPanel/parser/types.ts`

**Step 1: Create types file**

```typescript
export type MongoMethod =
  | 'find'
  | 'findOne'
  | 'aggregate'
  | 'insertOne'
  | 'insertMany'
  | 'updateOne'
  | 'updateMany'
  | 'deleteOne'
  | 'deleteMany'
  | 'countDocuments'
  | 'distinct'
  | 'createIndex'
  | 'dropIndex';

export interface ChainOptions {
  limit?: number;
  skip?: number;
  sort?: Record<string, unknown>;
  projection?: Record<string, unknown>;
  hint?: Record<string, unknown>;
  maxTimeMS?: number;
  explain?: boolean;
  count?: boolean;
}

export interface ParsedShellCommand {
  collection: string;
  method: MongoMethod;
  args: unknown[];
  options: ChainOptions;
}

export interface ParseResult {
  success: true;
  command: ParsedShellCommand;
}

export interface ParseError {
  success: false;
  error: string;
  position?: { line: number; column: number };
}

export type ShellParseResult = ParseResult | ParseError;
```

**Step 2: Verify no type errors**

Run:
```bash
pnpm typecheck 2>&1 | grep -E "parser/types"
```

Expected: No output (no errors)

**Step 3: Commit**

```bash
git add src/components/MongoQueryPanel/parser/types.ts
git commit -m "feat(mongo): add shell parser type definitions"
```

---

## Task 3: Create Shell Parser

**Files:**
- Create: `src/components/MongoQueryPanel/parser/shell-parser.ts`

**Step 1: Create parser implementation**

```typescript
import { parse as parseShellBson } from '@mongodb-js/shell-bson-parser';
import type { ShellParseResult, MongoMethod, ChainOptions } from './types';

const VALID_METHODS: MongoMethod[] = [
  'find', 'findOne', 'aggregate', 'insertOne', 'insertMany',
  'updateOne', 'updateMany', 'deleteOne', 'deleteMany',
  'countDocuments', 'distinct', 'createIndex', 'dropIndex',
];

const CHAIN_METHODS = ['limit', 'skip', 'sort', 'projection', 'hint', 'maxTimeMS', 'explain', 'count', 'toArray'];

export function parseShellCommand(input: string): ShellParseResult {
  const trimmed = input.trim();
  
  if (!trimmed) {
    return { success: false, error: 'Empty query' };
  }

  if (!trimmed.startsWith('db.')) {
    return { success: false, error: 'Query must start with "db."' };
  }

  try {
    const { collection, method, argsStr, chainStr } = extractParts(trimmed);
    
    if (!collection) {
      return { success: false, error: 'Missing collection name after "db."' };
    }

    if (!method) {
      return { success: false, error: `Missing method call on "db.${collection}"` };
    }

    if (!VALID_METHODS.includes(method as MongoMethod)) {
      return { success: false, error: `Unknown method "${method}"` };
    }

    const args = parseArgs(argsStr);
    const options = parseChain(chainStr);

    return {
      success: true,
      command: {
        collection,
        method: method as MongoMethod,
        args,
        options,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function extractParts(input: string): {
  collection: string;
  method: string;
  argsStr: string;
  chainStr: string;
} {
  const afterDb = input.slice(3);
  
  const firstDot = afterDb.indexOf('.');
  if (firstDot === -1) {
    return { collection: afterDb, method: '', argsStr: '', chainStr: '' };
  }

  const collection = afterDb.slice(0, firstDot);
  const rest = afterDb.slice(firstDot + 1);

  const parenIndex = rest.indexOf('(');
  if (parenIndex === -1) {
    return { collection, method: rest, argsStr: '', chainStr: '' };
  }

  const method = rest.slice(0, parenIndex);
  
  const closingParen = findMatchingParen(rest, parenIndex);
  if (closingParen === -1) {
    throw new Error('Unmatched parenthesis');
  }

  const argsStr = rest.slice(parenIndex + 1, closingParen);
  const chainStr = rest.slice(closingParen + 1);

  return { collection, method, argsStr, chainStr };
}

function findMatchingParen(str: string, openIndex: number): number {
  let depth = 1;
  let inString = false;
  let stringChar = '';
  
  for (let i = openIndex + 1; i < str.length; i++) {
    const char = str[i];
    const prevChar = str[i - 1];
    
    if (inString) {
      if (char === stringChar && prevChar !== '\\') {
        inString = false;
      }
      continue;
    }
    
    if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
      continue;
    }
    
    if (char === '(') depth++;
    if (char === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  
  return -1;
}

function parseArgs(argsStr: string): unknown[] {
  if (!argsStr.trim()) return [];
  
  const wrapped = `[${argsStr}]`;
  
  try {
    const parsed = parseShellBson(wrapped, { mode: 'loose' });
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [JSON.parse(wrapped)];
  }
}

function parseChain(chainStr: string): ChainOptions {
  const options: ChainOptions = {};
  
  if (!chainStr.trim()) return options;

  const chainRegex = /\.(\w+)\(([^)]*)\)/g;
  let match;
  
  while ((match = chainRegex.exec(chainStr)) !== null) {
    const [, methodName, argStr] = match;
    
    if (!CHAIN_METHODS.includes(methodName)) continue;

    try {
      const value = argStr.trim() ? parseShellBson(argStr, { mode: 'loose' }) : true;
      
      switch (methodName) {
        case 'limit':
          options.limit = Number(value);
          break;
        case 'skip':
          options.skip = Number(value);
          break;
        case 'sort':
          options.sort = value as Record<string, unknown>;
          break;
        case 'projection':
          options.projection = value as Record<string, unknown>;
          break;
        case 'hint':
          options.hint = value as Record<string, unknown>;
          break;
        case 'maxTimeMS':
          options.maxTimeMS = Number(value);
          break;
        case 'explain':
          options.explain = true;
          break;
        case 'count':
          options.count = true;
          break;
      }
    } catch {
      // Skip invalid chain arguments
    }
  }
  
  return options;
}

export function isShellSyntax(input: string): boolean {
  return input.trim().startsWith('db.');
}
```

**Step 2: Verify no type errors**

Run:
```bash
pnpm typecheck 2>&1 | grep -E "shell-parser"
```

Expected: No output (no errors)

**Step 3: Commit**

```bash
git add src/components/MongoQueryPanel/parser/shell-parser.ts
git commit -m "feat(mongo): implement shell command parser"
```

---

## Task 4: Create Parser Index

**Files:**
- Create: `src/components/MongoQueryPanel/parser/index.ts`

**Step 1: Create index file**

```typescript
export * from './types';
export * from './shell-parser';
```

**Step 2: Commit**

```bash
git add src/components/MongoQueryPanel/parser/index.ts
git commit -m "feat(mongo): add parser module exports"
```

---

## Task 5: Create Shell-JSON Converter

**Files:**
- Create: `src/components/MongoQueryPanel/converter.ts`

**Step 1: Create converter implementation**

```typescript
import { parseShellCommand, isShellSyntax } from './parser';
import type { ParsedShellCommand } from './parser';

export interface JsonQuery {
  [key: string]: unknown;
  find?: string;
  aggregate?: string;
  insert?: string;
  update?: string;
  delete?: string;
  count?: string;
  filter?: Record<string, unknown>;
  pipeline?: unknown[];
  document?: Record<string, unknown>;
  documents?: Record<string, unknown>[];
  updateDoc?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  sort?: Record<string, unknown>;
  projection?: Record<string, unknown>;
}

export function shellToJson(shell: string): string {
  const result = parseShellCommand(shell);
  
  if (!result.success) {
    throw new Error(result.error);
  }

  const { command } = result;
  const json = commandToJson(command);
  
  return JSON.stringify(json, null, 2);
}

function commandToJson(cmd: ParsedShellCommand): JsonQuery {
  const json: JsonQuery = {};
  
  switch (cmd.method) {
    case 'find':
    case 'findOne':
      json.find = cmd.collection;
      if (cmd.args[0]) json.filter = cmd.args[0] as Record<string, unknown>;
      if (cmd.args[1]) json.projection = cmd.args[1] as Record<string, unknown>;
      break;
      
    case 'aggregate':
      json.aggregate = cmd.collection;
      json.pipeline = cmd.args[0] as unknown[] || [];
      break;
      
    case 'insertOne':
      json.insert = cmd.collection;
      json.document = cmd.args[0] as Record<string, unknown>;
      break;
      
    case 'insertMany':
      json.insert = cmd.collection;
      json.documents = cmd.args[0] as Record<string, unknown>[];
      break;
      
    case 'updateOne':
    case 'updateMany':
      json.update = cmd.collection;
      json.filter = cmd.args[0] as Record<string, unknown>;
      json.updateDoc = cmd.args[1] as Record<string, unknown>;
      break;
      
    case 'deleteOne':
    case 'deleteMany':
      json.delete = cmd.collection;
      json.filter = cmd.args[0] as Record<string, unknown>;
      break;
      
    case 'countDocuments':
      json.count = cmd.collection;
      if (cmd.args[0]) json.filter = cmd.args[0] as Record<string, unknown>;
      break;
      
    default:
      json.command = { [cmd.method]: cmd.collection, ...cmd.args[0] as object };
  }

  if (cmd.options.limit) json.limit = cmd.options.limit;
  if (cmd.options.skip) json.skip = cmd.options.skip;
  if (cmd.options.sort) json.sort = cmd.options.sort;
  if (cmd.options.projection && !json.projection) json.projection = cmd.options.projection;
  
  return json;
}

export function jsonToShell(jsonStr: string): string {
  const json = JSON.parse(jsonStr) as JsonQuery;
  
  let shell = 'db.';
  let collection = '';
  let method = '';
  const args: string[] = [];
  const chains: string[] = [];

  if (json.find) {
    collection = json.find;
    method = 'find';
    if (json.filter) args.push(JSON.stringify(json.filter));
    if (json.projection && !json.limit && !json.skip && !json.sort) {
      args.push(JSON.stringify(json.projection));
    }
  } else if (json.aggregate) {
    collection = json.aggregate;
    method = 'aggregate';
    args.push(JSON.stringify(json.pipeline || []));
  } else if (json.insert) {
    collection = json.insert;
    if (json.documents) {
      method = 'insertMany';
      args.push(JSON.stringify(json.documents));
    } else {
      method = 'insertOne';
      args.push(JSON.stringify(json.document || {}));
    }
  } else if (json.update) {
    collection = json.update;
    method = 'updateOne';
    args.push(JSON.stringify(json.filter || {}));
    args.push(JSON.stringify(json.updateDoc || {}));
  } else if (json.delete) {
    collection = json.delete;
    method = 'deleteMany';
    args.push(JSON.stringify(json.filter || {}));
  } else if (json.count) {
    collection = json.count;
    method = 'countDocuments';
    if (json.filter) args.push(JSON.stringify(json.filter));
  } else {
    throw new Error('Unknown query format');
  }

  if (json.sort) chains.push(`.sort(${JSON.stringify(json.sort)})`);
  if (json.limit) chains.push(`.limit(${json.limit})`);
  if (json.skip) chains.push(`.skip(${json.skip})`);
  if (json.projection && (json.limit || json.skip || json.sort)) {
    chains.push(`.projection(${JSON.stringify(json.projection)})`);
  }

  shell += `${collection}.${method}(${args.join(', ')})${chains.join('')}`;
  
  return shell;
}

export function detectMode(input: string): 'shell' | 'json' {
  const trimmed = input.trim();
  if (!trimmed) return 'shell';
  
  if (isShellSyntax(trimmed)) return 'shell';
  
  try {
    JSON.parse(trimmed);
    return 'json';
  } catch {
    return 'shell';
  }
}
```

**Step 2: Verify no type errors**

Run:
```bash
pnpm typecheck 2>&1 | grep -E "converter"
```

Expected: No output (no errors)

**Step 3: Commit**

```bash
git add src/components/MongoQueryPanel/converter.ts
git commit -m "feat(mongo): add shell/json bidirectional converter"
```

---

## Task 6: Add MongoDB Language to CodeEditor Types

**Files:**
- Modify: `src/components/CodeEditor/types.ts`

**Step 1: Add mongodb language type**

Change line 2 from:
```typescript
export type CodeEditorLanguage = "sql" | "json" | "text" | "dbml" | "redis";
```

To:
```typescript
export type CodeEditorLanguage = "sql" | "json" | "text" | "dbml" | "redis" | "mongodb";
```

**Step 2: Verify no type errors**

Run:
```bash
pnpm typecheck 2>&1 | grep -E "types.ts"
```

Expected: No output (no errors)

**Step 3: Commit**

```bash
git add src/components/CodeEditor/types.ts
git commit -m "feat(editor): add mongodb language type"
```

---

## Task 7: Create MongoDB Operators Module

**Files:**
- Create: `src/components/MongoQueryPanel/intellisense/operators.ts`

**Step 1: Create operators wrapper**

```typescript
import {
  QUERY_OPERATORS,
  STAGE_OPERATORS,
  ACCUMULATORS,
  BSON_TYPES,
} from '@mongodb-js/mongodb-constants';

export interface OperatorInfo {
  name: string;
  description: string;
  snippet?: string;
}

export const queryOperators: OperatorInfo[] = QUERY_OPERATORS.map((op) => ({
  name: op.name,
  description: op.description || `Query operator ${op.name}`,
  snippet: op.snippet,
}));

export const stageOperators: OperatorInfo[] = STAGE_OPERATORS.map((op) => ({
  name: op.name,
  description: op.description || `Aggregation stage ${op.name}`,
  snippet: op.snippet,
}));

export const accumulators: OperatorInfo[] = ACCUMULATORS.map((op) => ({
  name: op.name,
  description: op.description || `Accumulator ${op.name}`,
  snippet: op.snippet,
}));

export const bsonTypes: OperatorInfo[] = BSON_TYPES.map((t) => ({
  name: t.name,
  description: t.description || `BSON type ${t.name}`,
}));

export const collectionMethods: OperatorInfo[] = [
  { name: 'find', description: 'Find documents matching a query', snippet: 'find({$1})' },
  { name: 'findOne', description: 'Find a single document', snippet: 'findOne({$1})' },
  { name: 'aggregate', description: 'Run an aggregation pipeline', snippet: 'aggregate([$1])' },
  { name: 'insertOne', description: 'Insert a single document', snippet: 'insertOne({$1})' },
  { name: 'insertMany', description: 'Insert multiple documents', snippet: 'insertMany([$1])' },
  { name: 'updateOne', description: 'Update a single document', snippet: 'updateOne({$1}, {$2})' },
  { name: 'updateMany', description: 'Update multiple documents', snippet: 'updateMany({$1}, {$2})' },
  { name: 'deleteOne', description: 'Delete a single document', snippet: 'deleteOne({$1})' },
  { name: 'deleteMany', description: 'Delete multiple documents', snippet: 'deleteMany({$1})' },
  { name: 'countDocuments', description: 'Count documents matching a query', snippet: 'countDocuments({$1})' },
  { name: 'distinct', description: 'Get distinct values for a field', snippet: 'distinct("$1")' },
];

export const cursorMethods: OperatorInfo[] = [
  { name: 'limit', description: 'Limit the number of results', snippet: 'limit($1)' },
  { name: 'skip', description: 'Skip a number of results', snippet: 'skip($1)' },
  { name: 'sort', description: 'Sort the results', snippet: 'sort({$1: 1})' },
  { name: 'projection', description: 'Project specific fields', snippet: 'projection({$1: 1})' },
  { name: 'hint', description: 'Force use of a specific index', snippet: 'hint({$1: 1})' },
  { name: 'maxTimeMS', description: 'Set maximum execution time', snippet: 'maxTimeMS($1)' },
  { name: 'explain', description: 'Return query execution plan', snippet: 'explain()' },
  { name: 'count', description: 'Return count instead of documents', snippet: 'count()' },
  { name: 'toArray', description: 'Convert cursor to array', snippet: 'toArray()' },
];
```

**Step 2: Verify no type errors**

Run:
```bash
pnpm typecheck 2>&1 | grep -E "operators.ts"
```

Expected: No output (no errors)

**Step 3: Commit**

```bash
git add src/components/MongoQueryPanel/intellisense/operators.ts
git commit -m "feat(mongo): add MongoDB operators and methods definitions"
```

---

## Task 8: Create Method Signatures Module

**Files:**
- Create: `src/components/MongoQueryPanel/intellisense/signatures.ts`

**Step 1: Create signatures file**

```typescript
export interface ParameterInfo {
  name: string;
  type: string;
  description: string;
  optional?: boolean;
}

export interface MethodSignature {
  method: string;
  description: string;
  parameters: ParameterInfo[];
  returns: string;
}

export const methodSignatures: Record<string, MethodSignature> = {
  find: {
    method: 'find',
    description: 'Selects documents in a collection that match the query criteria',
    parameters: [
      { name: 'filter', type: 'document', description: 'Query filter document', optional: true },
      { name: 'projection', type: 'document', description: 'Fields to return', optional: true },
    ],
    returns: 'Cursor',
  },
  findOne: {
    method: 'findOne',
    description: 'Returns one document that matches the query',
    parameters: [
      { name: 'filter', type: 'document', description: 'Query filter document', optional: true },
      { name: 'projection', type: 'document', description: 'Fields to return', optional: true },
    ],
    returns: 'Document | null',
  },
  aggregate: {
    method: 'aggregate',
    description: 'Performs aggregation operations using the aggregation pipeline',
    parameters: [
      { name: 'pipeline', type: 'array', description: 'Array of aggregation stages' },
      { name: 'options', type: 'document', description: 'Aggregation options', optional: true },
    ],
    returns: 'Cursor',
  },
  insertOne: {
    method: 'insertOne',
    description: 'Inserts a single document into a collection',
    parameters: [
      { name: 'document', type: 'document', description: 'Document to insert' },
    ],
    returns: 'InsertOneResult',
  },
  insertMany: {
    method: 'insertMany',
    description: 'Inserts multiple documents into a collection',
    parameters: [
      { name: 'documents', type: 'array', description: 'Array of documents to insert' },
    ],
    returns: 'InsertManyResult',
  },
  updateOne: {
    method: 'updateOne',
    description: 'Updates a single document matching the filter',
    parameters: [
      { name: 'filter', type: 'document', description: 'Query filter document' },
      { name: 'update', type: 'document', description: 'Update operations' },
      { name: 'options', type: 'document', description: 'Update options', optional: true },
    ],
    returns: 'UpdateResult',
  },
  updateMany: {
    method: 'updateMany',
    description: 'Updates all documents matching the filter',
    parameters: [
      { name: 'filter', type: 'document', description: 'Query filter document' },
      { name: 'update', type: 'document', description: 'Update operations' },
      { name: 'options', type: 'document', description: 'Update options', optional: true },
    ],
    returns: 'UpdateResult',
  },
  deleteOne: {
    method: 'deleteOne',
    description: 'Deletes a single document matching the filter',
    parameters: [
      { name: 'filter', type: 'document', description: 'Query filter document' },
    ],
    returns: 'DeleteResult',
  },
  deleteMany: {
    method: 'deleteMany',
    description: 'Deletes all documents matching the filter',
    parameters: [
      { name: 'filter', type: 'document', description: 'Query filter document' },
    ],
    returns: 'DeleteResult',
  },
  countDocuments: {
    method: 'countDocuments',
    description: 'Returns the count of documents matching the query',
    parameters: [
      { name: 'filter', type: 'document', description: 'Query filter document', optional: true },
    ],
    returns: 'number',
  },
  distinct: {
    method: 'distinct',
    description: 'Returns distinct values for a field',
    parameters: [
      { name: 'field', type: 'string', description: 'Field name' },
      { name: 'filter', type: 'document', description: 'Query filter document', optional: true },
    ],
    returns: 'array',
  },
};

export function getSignature(method: string): MethodSignature | undefined {
  return methodSignatures[method];
}

export function formatSignature(sig: MethodSignature): string {
  const params = sig.parameters
    .map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`)
    .join(', ');
  return `${sig.method}(${params}): ${sig.returns}`;
}
```

**Step 2: Commit**

```bash
git add src/components/MongoQueryPanel/intellisense/signatures.ts
git commit -m "feat(mongo): add method signature definitions"
```

---

## Task 9: Create Intellisense Index

**Files:**
- Create: `src/components/MongoQueryPanel/intellisense/index.ts`

**Step 1: Create index file**

```typescript
export * from './operators';
export * from './signatures';
```

**Step 2: Commit**

```bash
git add src/components/MongoQueryPanel/intellisense/index.ts
git commit -m "feat(mongo): add intellisense module exports"
```

---

## Task 10: Create MongoDB Language Extension

**Files:**
- Create: `src/components/CodeEditor/languages/mongodb/index.ts`

**Step 1: Create MongoDB language support**

```typescript
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { parseShellCommand } from '@/components/MongoQueryPanel/parser';
import {
  queryOperators,
  stageOperators,
  accumulators,
  collectionMethods,
  cursorMethods,
} from '@/components/MongoQueryPanel/intellisense';

export interface MongoLanguageOptions {
  collections?: string[];
  fields?: string[];
}

export function mongodbLanguage(options: MongoLanguageOptions = {}): Extension[] {
  return [
    javascript(),
    autocompletion({
      override: [createMongoCompletionSource(options)],
      activateOnTyping: true,
      activateOnTypingDelay: 100,
    }),
    createMongoLinter(),
  ];
}

function createMongoCompletionSource(options: MongoLanguageOptions) {
  return (context: CompletionContext) => {
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const textBefore = line.text.slice(0, pos - line.from);
    
    // After "db." - suggest collections
    if (textBefore.match(/db\.$/)) {
      const collections = options.collections || ['collection_name'];
      return {
        from: pos,
        options: collections.map((c): Completion => ({
          label: c,
          type: 'variable',
          detail: 'collection',
        })),
      };
    }

    // After "db.collection." - suggest methods
    const methodMatch = textBefore.match(/db\.\w+\.$/);
    if (methodMatch) {
      return {
        from: pos,
        options: collectionMethods.map((m): Completion => ({
          label: m.name,
          type: 'method',
          detail: m.description,
          apply: m.snippet,
        })),
      };
    }

    // After cursor method call, suggest chaining
    const chainMatch = textBefore.match(/\)\s*\.$/);
    if (chainMatch) {
      return {
        from: pos,
        options: cursorMethods.map((m): Completion => ({
          label: m.name,
          type: 'method',
          detail: m.description,
          apply: m.snippet,
        })),
      };
    }

    // Inside { $ - suggest query operators
    const operatorMatch = textBefore.match(/\{\s*\$$/);
    if (operatorMatch) {
      return {
        from: pos - 1,
        options: queryOperators.map((op): Completion => ({
          label: op.name,
          type: 'keyword',
          detail: op.description,
        })),
      };
    }

    // Inside [{ $ in aggregate - suggest stage operators
    const stageMatch = textBefore.match(/\[\s*\{\s*\$$/);
    if (stageMatch) {
      return {
        from: pos - 1,
        options: stageOperators.map((op): Completion => ({
          label: op.name,
          type: 'keyword',
          detail: op.description,
        })),
      };
    }

    // Inside $group or similar - suggest accumulators
    const accMatch = textBefore.match(/\$group\s*:\s*\{[^}]*\$$/);
    if (accMatch) {
      return {
        from: pos - 1,
        options: accumulators.map((op): Completion => ({
          label: op.name,
          type: 'keyword',
          detail: op.description,
        })),
      };
    }

    // Field suggestions inside filter objects
    if (options.fields && textBefore.match(/\{\s*[^}]*$/)) {
      const wordMatch = textBefore.match(/(\w*)$/);
      if (wordMatch) {
        const word = wordMatch[1];
        const from = pos - word.length;
        return {
          from,
          options: options.fields
            .filter((f) => f.startsWith(word))
            .map((f): Completion => ({
              label: f,
              type: 'property',
              detail: 'field',
            })),
        };
      }
    }

    return null;
  };
}

function createMongoLinter(): Extension {
  return linter((view) => {
    const diagnostics: Diagnostic[] = [];
    const doc = view.state.doc.toString();
    
    if (!doc.trim()) return diagnostics;
    
    // Only lint shell syntax
    if (!doc.trim().startsWith('db.')) return diagnostics;

    const result = parseShellCommand(doc);
    
    if (!result.success) {
      diagnostics.push({
        from: 0,
        to: doc.length,
        severity: 'error',
        message: result.error,
      });
    }

    return diagnostics;
  });
}
```

**Step 2: Verify no type errors**

Run:
```bash
pnpm typecheck 2>&1 | grep -E "languages/mongodb"
```

Expected: No output (no errors)

**Step 3: Commit**

```bash
git add src/components/CodeEditor/languages/mongodb/index.ts
git commit -m "feat(editor): add MongoDB language support with completions and linting"
```

---

## Task 11: Register MongoDB Language in Extensions

**Files:**
- Modify: `src/components/CodeEditor/extensions.ts`

**Step 1: Import MongoDB language**

Add after line 42 (after dbmlMixed import):
```typescript
import { mongodbLanguage } from "./languages/mongodb";
```

**Step 2: Add mongodb case in getLanguageExtension**

Add after line 308 (after redis case, before default):
```typescript
    case "mongodb":
      return mongodbLanguage();
```

**Step 3: Verify no type errors**

Run:
```bash
pnpm typecheck 2>&1 | grep -E "extensions.ts"
```

Expected: No output (no errors)

**Step 4: Commit**

```bash
git add src/components/CodeEditor/extensions.ts
git commit -m "feat(editor): register MongoDB language in editor extensions"
```

---

## Task 12: Update MongoQueryToolbar with Mode Toggle

**Files:**
- Modify: `src/components/MongoQueryPanel/MongoQueryToolbar.tsx`

**Step 1: Update toolbar with mode toggle**

Replace entire file content:

```typescript
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  IconPlayerPlay,
  IconPlayerStop,
  IconWand,
  IconTrash,
} from "@tabler/icons-react";

export type QueryMode = "shell" | "json";

interface MongoQueryToolbarProps {
  isExecuting: boolean;
  onExecute: () => void;
  onCancel: () => void;
  onFormat: () => void;
  onClear: () => void;
  hasQuery: boolean;
  hasResults: boolean;
  mode: QueryMode;
  onModeChange: (mode: QueryMode) => void;
}

export const MongoQueryToolbar = memo(function MongoQueryToolbar({
  isExecuting,
  onExecute,
  onCancel,
  onFormat,
  onClear,
  hasQuery,
  hasResults,
  mode,
  onModeChange,
}: MongoQueryToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-1.5 px-2 py-1.5 bg-muted/20 border-b border-border/50">
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant={isExecuting ? "destructive" : "default"}
          onClick={isExecuting ? onCancel : onExecute}
          disabled={!hasQuery && !isExecuting}
          className="h-7 text-xs gap-1.5 px-3 font-medium shadow-sm transition-all"
        >
          {isExecuting ? (
            <>
              <IconPlayerStop className="h-3.5 w-3.5" />
              <span>Stop</span>
            </>
          ) : (
            <>
              <IconPlayerPlay className="h-3.5 w-3.5" />
              <span>Run</span>
            </>
          )}
        </Button>

        <div className="w-px h-4 bg-border mx-1" />

        <Button
          size="sm"
          variant="ghost"
          onClick={onFormat}
          disabled={isExecuting || !hasQuery}
          className="h-7 text-xs gap-1.5 px-2 text-muted-foreground hover:text-foreground"
          title="Format"
        >
          <IconWand className="h-3.5 w-3.5" />
          <span>Format</span>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value) onModeChange(value as QueryMode);
          }}
          className="h-7"
        >
          <ToggleGroupItem
            value="shell"
            className="h-7 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            Shell
          </ToggleGroupItem>
          <ToggleGroupItem
            value="json"
            className="h-7 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            JSON
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="w-px h-4 bg-border" />

        <Button
          size="sm"
          variant="ghost"
          onClick={onClear}
          disabled={!hasResults}
          className="h-7 text-xs gap-1.5 px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          title="Clear Results"
        >
          <IconTrash className="h-3.5 w-3.5" />
          <span>Clear</span>
        </Button>
      </div>
    </div>
  );
});
```

**Step 2: Verify no type errors**

Run:
```bash
pnpm typecheck 2>&1 | grep -E "MongoQueryToolbar"
```

Expected: May show errors in MongoQueryPanel.tsx (will fix in next task)

**Step 3: Commit**

```bash
git add src/components/MongoQueryPanel/MongoQueryToolbar.tsx
git commit -m "feat(mongo): add mode toggle to toolbar"
```

---

## Task 13: Update MongoQueryPanel with Shell Mode Support

**Files:**
- Modify: `src/components/MongoQueryPanel/MongoQueryPanel.tsx`

**Step 1: Replace entire file content**

```typescript
import { useState, useCallback, memo } from "react";
import { toast } from "sonner";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { CodeEditor } from "@/components/CodeEditor";
import { MongoDBAdapter } from "@/adapters/mongodb";
import { MongoQueryToolbar, type QueryMode } from "./MongoQueryToolbar";
import { parseShellCommand } from "./parser";
import { shellToJson, jsonToShell, detectMode } from "./converter";
import { logger } from "@/lib/logger";

interface MongoQueryPanelProps {
  panelId: string;
  tabId: string;
  connectionId: string;
  database: string;
  className?: string;
  initialQuery?: string;
}

const DEFAULT_SHELL_QUERY = `db.collection_name.find({}).limit(20)`;

const DEFAULT_JSON_QUERY = `{
  "find": "collection_name",
  "filter": {},
  "limit": 20
}`;

export const MongoQueryPanel = memo(function MongoQueryPanel({
  panelId: _panelId,
  tabId: _tabId,
  connectionId,
  database,
  className,
  initialQuery,
}: MongoQueryPanelProps) {
  const detectedMode = initialQuery ? detectMode(initialQuery) : "shell";
  const defaultQuery = initialQuery || (detectedMode === "shell" ? DEFAULT_SHELL_QUERY : DEFAULT_JSON_QUERY);

  const [query, setQuery] = useState(defaultQuery);
  const [mode, setMode] = useState<QueryMode>(detectedMode);
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<string>("");
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  const handleFocusPanel = useCallback(() => {
    // Focus panel when interacting
  }, []);

  const handleModeChange = useCallback((newMode: QueryMode) => {
    if (newMode === mode) return;

    try {
      if (newMode === "json" && query.trim().startsWith("db.")) {
        const converted = shellToJson(query);
        setQuery(converted);
      } else if (newMode === "shell" && !query.trim().startsWith("db.")) {
        const converted = jsonToShell(query);
        setQuery(converted);
      }
      setMode(newMode);
    } catch (err) {
      toast.error("Conversion failed", {
        description: err instanceof Error ? err.message : "Invalid query format",
      });
    }
  }, [mode, query]);

  const handleExecute = useCallback(async () => {
    if (!query.trim()) return;

    setIsExecuting(true);
    setResult("");
    setExecutionTime(null);
    const startTime = performance.now();

    try {
      const adapter = new MongoDBAdapter(connectionId);
      let queryResult;

      if (mode === "shell") {
        const parsed = parseShellCommand(query);
        if (!parsed.success) {
          throw new Error(parsed.error);
        }

        const { command } = parsed;
        const { collection, method, args, options } = command;

        logger.info("[MongoQueryPanel] Executing shell command", { collection, method, options });

        switch (method) {
          case "find":
          case "findOne": {
            const filter = (args[0] as object) || {};
            const findOptions = {
              limit: options.limit,
              skip: options.skip,
              sort: options.sort,
              projection: options.projection || (args[1] as object),
            };
            queryResult = await adapter.findDocuments(collection, filter, findOptions);
            if (options.count) {
              queryResult = { count: (queryResult as unknown[]).length };
            }
            break;
          }
          case "aggregate":
            queryResult = await adapter.aggregate(collection, (args[0] as object[]) || []);
            break;
          case "insertOne":
            queryResult = await adapter.insertDocument(collection, (args[0] as object) || {});
            break;
          case "insertMany":
            queryResult = await adapter.insertDocuments(collection, (args[0] as object[]) || []);
            break;
          case "updateOne":
          case "updateMany":
            queryResult = await adapter.updateDocument(
              collection,
              (args[0] as object) || {},
              (args[1] as object) || {}
            );
            break;
          case "deleteOne":
          case "deleteMany":
            queryResult = await adapter.deleteDocument(collection, (args[0] as object) || {});
            break;
          case "countDocuments":
            queryResult = await adapter.countDocuments(collection, args[0] as object);
            break;
          default:
            queryResult = await adapter.runCommand({ [method]: collection, ...((args[0] as object) || {}) });
        }
      } else {
        // JSON mode - existing logic
        const parsedQuery = JSON.parse(query);

        if (parsedQuery.find) {
          const collection = parsedQuery.find;
          const filter = parsedQuery.filter || {};
          const options = {
            limit: parsedQuery.limit,
            skip: parsedQuery.skip,
            sort: parsedQuery.sort,
            projection: parsedQuery.projection,
          };
          queryResult = await adapter.findDocuments(collection, filter, options);
        } else if (parsedQuery.aggregate) {
          queryResult = await adapter.aggregate(parsedQuery.aggregate, parsedQuery.pipeline || []);
        } else if (parsedQuery.insert) {
          const docs = parsedQuery.documents || parsedQuery.document;
          if (Array.isArray(docs)) {
            queryResult = await adapter.insertDocuments(parsedQuery.insert, docs);
          } else {
            queryResult = await adapter.insertDocument(parsedQuery.insert, docs);
          }
        } else if (parsedQuery.update) {
          queryResult = await adapter.updateDocument(
            parsedQuery.update,
            parsedQuery.filter || {},
            parsedQuery.updateDoc || parsedQuery.update
          );
        } else if (parsedQuery.delete) {
          queryResult = await adapter.deleteDocument(parsedQuery.delete, parsedQuery.filter || {});
        } else if (parsedQuery.count) {
          queryResult = await adapter.countDocuments(parsedQuery.count, parsedQuery.filter);
        } else {
          queryResult = await adapter.runCommand(parsedQuery);
        }
      }

      const endTime = performance.now();
      setExecutionTime(endTime - startTime);
      setResult(JSON.stringify(queryResult, null, 2));
      toast.success("Query executed successfully");
    } catch (err) {
      logger.error("[MongoQueryPanel] Execution failed", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Execution failed", { description: msg });
      setResult(JSON.stringify({ error: msg }, null, 2));
    } finally {
      setIsExecuting(false);
    }
  }, [query, connectionId, mode]);

  const handleFormat = useCallback(() => {
    try {
      if (mode === "json") {
        const parsed = JSON.parse(query);
        setQuery(JSON.stringify(parsed, null, 2));
      } else {
        // For shell mode, just validate it parses
        const result = parseShellCommand(query);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("Query is valid");
      }
    } catch {
      toast.error("Invalid query format");
    }
  }, [query, mode]);

  const handleClearResults = useCallback(() => {
    setResult("");
    setExecutionTime(null);
  }, []);

  return (
    <div
      className={cn("flex flex-col h-full bg-background", className)}
      onMouseDown={handleFocusPanel}
      onFocus={handleFocusPanel}
    >
      <ResizablePanelGroup direction="vertical" className="h-full rounded-xl overflow-hidden">
        <ResizablePanel defaultSize={40} minSize={20} className="flex flex-col">
          <div className="flex-1 min-h-0 relative flex flex-col">
            <CodeEditor
              value={query}
              onChange={setQuery}
              language={mode === "shell" ? "mongodb" : "json"}
              connectionId={connectionId}
              database={database}
              onExecute={handleExecute}
              className="flex-1"
            />
            <MongoQueryToolbar
              isExecuting={isExecuting}
              onExecute={handleExecute}
              onCancel={() => {}}
              onFormat={handleFormat}
              onClear={handleClearResults}
              hasQuery={!!query.trim()}
              hasResults={!!result}
              mode={mode}
              onModeChange={handleModeChange}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle className="bg-secondary hover:bg-primary/50 transition-colors h-1" />

        <ResizablePanel defaultSize={60} minSize={20}>
          <div className="h-full flex flex-col bg-muted/10">
            {executionTime !== null && (
              <div className="px-3 py-1 text-xs text-muted-foreground border-b bg-muted/20 flex justify-between">
                <span>Results</span>
                <span>{executionTime.toFixed(2)}ms</span>
              </div>
            )}
            <div className="flex-1 min-h-0 relative">
              {result ? (
                <CodeEditor
                  value={result}
                  language="json"
                  readOnly={true}
                  lineNumbers={true}
                  className="h-full"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Run a query to see results
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
});
```

**Step 2: Verify no type errors**

Run:
```bash
pnpm typecheck 2>&1 | grep -E "MongoQueryPanel"
```

Expected: No output (no errors)

**Step 3: Commit**

```bash
git add src/components/MongoQueryPanel/MongoQueryPanel.tsx
git commit -m "feat(mongo): integrate shell mode with parser and mode toggle"
```

---

## Task 14: Run Lint and Fix Issues

**Files:**
- Various files may need minor fixes

**Step 1: Run lint**

Run:
```bash
pnpm lint 2>&1 | grep -E "(MongoQueryPanel|parser|intellisense|mongodb)" -A 2
```

**Step 2: Fix any lint errors found**

Apply fixes based on lint output.

**Step 3: Run typecheck**

Run:
```bash
pnpm typecheck 2>&1 | tail -20
```

**Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix(mongo): resolve lint and type errors"
```

---

## Task 15: Manual Testing

**Step 1: Start dev server**

Run:
```bash
make dev
```

**Step 2: Test Shell Mode**

1. Connect to a MongoDB database
2. Press Cmd+T to open new query tab
3. Verify mode toggle shows "Shell" selected
4. Type: `db.users.find({}).limit(10)`
5. Press Cmd+Enter or click Run
6. Verify results appear

**Step 3: Test Mode Toggle**

1. Click "JSON" toggle button
2. Verify query converts to JSON format
3. Click "Shell" toggle button
4. Verify query converts back to shell format

**Step 4: Test Autocomplete**

1. Type `db.` and verify collection suggestions appear
2. Type `db.users.` and verify method suggestions appear
3. Type `db.users.find({ $` and verify operator suggestions appear

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Install MongoDB dependencies |
| 2 | Create parser types |
| 3 | Create shell parser |
| 4 | Create parser index |
| 5 | Create shell-json converter |
| 6 | Add mongodb language type |
| 7 | Create operators module |
| 8 | Create method signatures |
| 9 | Create intellisense index |
| 10 | Create MongoDB language extension |
| 11 | Register MongoDB language |
| 12 | Update toolbar with mode toggle |
| 13 | Update MongoQueryPanel with shell support |
| 14 | Run lint and fix issues |
| 15 | Manual testing |
