# Frontend (React/TypeScript) Guidelines

## Recent UI Improvements
- **DataViewer Component**: Virtual scrolling with infinite loading for large datasets
- **Row Selection**: Stable selection using row IDs instead of indices
- **Column Virtualization**: Fixed width calculations for off-viewport columns
- **Resizable Panels**: Always-mounted ResizablePanelGroup to prevent flashing
- **Compact Toolbar**: Reduced heights for space efficiency (h-6 for buttons, h-5 for toggles)
- **Backdrop Blur Headers**: Sticky headers with backdrop-filter for all tables

## UI Component Patterns

### Component Organization
- Use functional components with TypeScript
- Place reusable UI components in `/components/ui/`
- Application-specific components in `/components/`
- Screen-level components in `/screens/`

### State Management
- Zustand stores in `/stores/` directory
- Use typed store hooks with TypeScript
- Secure stores prefix with "secure" (e.g., secureConnectionStore)

### Styling Conventions
- Tailwind CSS for utility-first styling
- shadcn/ui components with Radix UI primitives
- Custom styles in `/styles/` directory
- Use `cn()` helper from `/lib/utils` for conditional classes

### Security Practices
- Never store sensitive data in plain text
- Use encryption services from `/services/secureStorage`
- Clear sensitive data from memory after use
- Validate all user inputs with Zod schemas

### Monaco Editor Integration
- Use `@monaco-editor/react` for SQL editing
- Configure with SQL language support
- Theme follows app theme (light/dark)

### Form Handling
- TanStack Form for form state management
- Zod for schema validation
- Use form adapters for type safety

### Query Management
- TanStack Query for server state
- Query keys in consistent format
- Optimistic updates where appropriate

### Virtual Scrolling
- Use TanStack Virtual for large lists
- Implement infinite scrolling with `FETCH_SIZE` and `WINDOW_SIZE` constants
- Preserve scroll position when layout changes
- Calculate total column width for proper horizontal scrolling

### Drag & Drop
- DnD Kit for sortable columns
- Separate drag handles from resize handles
- Use `restrictToHorizontalAxis` modifier for column reordering

### Data Table Features
- Column resizing with live preview
- Column visibility toggles with "Reset" option
- Global search with real-time filtering
- Export to CSV functionality
- Details panel with table/JSON view modes

## Performance Optimizations
- Memoize expensive components with `React.memo`
- Use `useDeferredValue` for selection state updates
- Implement windowing for large datasets (keep max 1000 rows in memory)
- Cache table data and schema with `cacheService`
- Avoid layout thrashing by calculating widths upfront
- Use `contain: strict` CSS for better scroll performance