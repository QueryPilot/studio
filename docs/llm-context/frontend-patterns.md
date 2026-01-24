# Frontend Patterns

## Tech Stack

- React 19 + TypeScript
- Vite (build)
- Tailwind CSS v4 + shadcn/ui
- Zustand (state management)
- CodeMirror 6 (SQL editor)
- Glide Data Grid (tables)
- XYFlow (ERD diagrams)

## Directory Structure

```
src/
├── screens/          # Page components (MainScreen, WorkspaceScreen)
├── components/       # UI components (shadcn/ui + custom)
├── stores/           # Zustand state management
├── services/         # Backend communication
├── hooks/            # Custom React hooks
├── adapters/         # Frontend database adapters
├── types/            # TypeScript interfaces
└── utils/            # Helpers
```

## Path Aliases

Configured in `vite.config.ts`:
- `@/` → `src/`
- `@components/` → `src/components/`
- `@hooks/` → `src/hooks/`
- `@types/` → `src/types/`
- `@utils/` → `src/utils/`
- `@lib/` → `src/lib/`

## Zustand Stores

Each store has a single concern:

| Store | Purpose |
|-------|---------|
| `connectionStoreNew` | Active connections, favorites, recents |
| `workbenchStore` | Layout tree, tab metadata, drag-drop |
| `workspaceScreenStore` | Schema/table navigation, filtering |
| `crudStore` | Transaction state, pending CRUD |
| `aiChatStore` | AI provider/model selection (persisted) |
| `dataInvalidationStore` | Event-driven cache invalidation |
| `panelStore` | Panel visibility and state |
| `tabStateStore` | Active tab tracking |
| `erdStore` | Entity relationship diagram data |

**Pattern**: Use Zustand for global state, React `useState` for local UI.

## Component Patterns

**Functional components with named exports:**
```tsx
export const MyComponent = ({ prop }: Props) => {
  // ...
}
```

**Conditional class merging with `cn()`:**
```tsx
import { cn } from '@/lib/utils'

<div className={cn("base-class", isActive && "active-class")} />
```

## Frontend Adapters

Type-safe paradigm dispatch:

```typescript
import { getAdapter, isSqlAdapter } from '@/adapters'

const adapter = getAdapter(connection)
if (isSqlAdapter(adapter)) {
  // SQL-specific operations
}
```

Available guards: `isSqlAdapter()`, `isDocumentAdapter()`, `isKeyValueAdapter()`

## Data Invalidation Pattern

```typescript
import { useDataInvalidationStore } from '@/stores/dataInvalidationStore'

// Subscribe to table changes
const unsubscribe = useDataInvalidationStore.getState()
  .subscribe('conn:db:schema:table', () => refetch())

// Trigger invalidation after CRUD
useDataInvalidationStore.getState().invalidateTable('conn:db:schema:table')
```

## Backend Communication

**Direct query** (metadata, small results):
```typescript
import { BackendAPI } from '@/services/backend'
const result = await BackendAPI.query(connectionId, sql)
```

**Streaming query** (data grids, large results):
```typescript
import { queryStreamClient } from '@/services/queryStreamClient'
await queryStreamClient.streamWithCallbacks(params, { onBatch })
```

See [Query Execution](../architecture/query-execution.md) for details.
