# Frontend (React/TypeScript) Guidelines

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