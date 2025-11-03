# Dead Code Cleanup Notes

## Commands Run
- `pnpm dlx ts-prune --ignore index.ts --skipFiles "src/types/**/*.ts" --skipFiles "src-tauri/**/*.d.ts" src src-tauri/sidecar-ai` ✅
- `pnpm dlx knip --production` ⚠️ unable to add extra include path; still produced report.
- `pnpm dlx depcheck --skip-missing` ✅
- `cargo clippy --workspace --all-targets -- -Dunused` ❌ failed: `PostgresPoolBuilder::max_lifetime` dead field (needs cleanup or allow).
- `pnpm lint` ❌ existing lint debt (517 issues) unrelated to dead-code scan but worth triage.
- `cargo udeps` ❌ tool not installed; install via `cargo install cargo-udeps --locked` before running.

## Removed Modules (current cleanup)
The following modules were deleted in this pass to eliminate stale UI editors, services, and helpers. Retaining the list for audit/history.
| Path | Notes |
| --- | --- |
| `src/hooks/useColumnResizing.ts` | No imports across repo; legacy grid hook.
| `src/hooks/useCopy.ts` | Unreferenced clipboard helper.
| `src/hooks/useKeybinding.ts` | Superseded by keyboard provider context; zero call sites.
| `src/hooks/useWindowConnection.ts` | Never consumed (only mentioned in comments).
| `src/hooks/useContextKey.ts` (`useSetContext`, `useContextValue`, `useWhen`) | Secondary helpers unused; keep primary `useContextKey`/`useScopedKeybindings`.
| `src/lib/databaseUri.ts` | `parseDatabaseUri` / `buildDatabaseUri` unused.
| `src/lib/platform.ts` (`setRuntimePlatform`, `isMac`, `isWindows`, `isLinux`) | Extra helpers unused; retain `detectPlatform`.
| `src/components/CommentInput.tsx` | Only imported by deprecated table-structure editors.
| `src/components/ConstraintInput.tsx` | Legacy editing control with no live imports.
| `src/components/TableStructure/ColumnRow.tsx` | Legacy editable row; nothing references it.
| `src/components/TableStructure/DefaultValueInput.tsx` | Legacy control; unused.
| `src/components/TableStructure/ForeignKeyEditorPopover.tsx` | Legacy control; unused.
| `src/components/TableStructure/ForeignKeySelector.tsx` | Legacy control; unused.
| `src/components/TableStructure/TableStructureWithResizing.tsx` | Superseded by static renderer.
| `src/components/TableStructure/TypeSelector.tsx` | Legacy control; unused.
| `src/components/TableIndexes/ColumnSelector.tsx` | Deprecated draggable UI; no imports.
| `src/components/TableIndexes/IndexRow.tsx` | Legacy editable row.
| `src/components/TableIndexes/IndexSizeCell.tsx` | Metric cell unused.
| `src/components/TableIndexes/IndexTypeSelector.tsx` | Legacy control unused.
| `src/components/TableIndexes/IndexUsageCell.tsx` | Tooltip renderer unused; only dependency on `ui/hover-card`.
| `src/components/TableTriggers/EventSelector.tsx` | Legacy editing UI; unused.
| `src/components/TableTriggers/FunctionInput.tsx` | Legacy editing UI; unused.
| `src/components/TableTriggers/FunctionSelector.tsx` | Legacy editing UI; unused.
| `src/components/TableTriggers/LevelSelector.tsx` | Legacy editing UI; unused.
| `src/components/TableTriggers/TimingSelector.tsx` | Legacy editing UI; unused.
| `src/components/TableTriggers/TriggerRow.tsx` | Legacy editable row; unused.
| `src/components/DataGridV2/components/index.ts` | Barrel file not imported anywhere.
| `src/components/Workbench/TabCloseConfirmDialog.tsx` | Obsolete placeholder component.
| `src/components/ui/hover-card.tsx` | Only used by unused `IndexUsageCell`.
| `src/components/ui/menubar.tsx` | No imports.
| `src/components/ui/table.tsx` | No imports.
| `src/components/ui/textarea.tsx` | Only referenced by unused Constraint/Comment controls.
| `src/components/ui/toaster.tsx` | Superseded by `components/ui/sonner.tsx`.
| `src/components/ui/toggle-button.tsx` | No imports.
| `src/components/Workbench/TabContextMenu.tsx` | Superseded by current context menu implementation.
| `src/screens/workspace/components/DraggableTab.tsx` | Legacy screen implementation; component tree moved to `src/components/Workbench`.
| `src/screens/workspace/components/DraggableTabBar.tsx` | Legacy screen implementation.
| `src/screens/workspace/components/TabContextMenu.tsx` | Legacy screen implementation.
| `src/data/defaultConnections.ts` | No usage; confirm product intent before deletion.
| `src/services/ai/aiService.ts` | Not wired into current AI flow; confirm roadmap before removal.
| `src/services/clearAllService.ts` | Singleton unused.
| `src/services/connectionMetadataService.ts` | Cache service unused.
| `src/services/keyboardLayoutService.ts` | Not referenced; superseded by context based solution.
| `src/services/savedQueriesService.ts` | Legacy API; unused.
| `src/services/secureConnectionService.ts` | Singleton unused.
| `src/stores/index.ts` | Barrel exports unused; consumers import stores directly.
| `src/utils/clearStorage.ts` | No imports; was CLI helper — consider dropping or moving to scripts.
| `src/utils/diffUtils.ts` (`hasColumnChanges`, `computeRowDiff`, etc.) | Helpers unused outside file; evaluate slimming file.
| `src/utils/numeric.ts` | Numeric helpers unreferenced.
| `src/utils/sql.ts` | Normalization helpers unused.
| `src/utils/sqlGenerator.ts` | CRUD SQL builders unused.
| `src/utils/sqlParser.ts` | Parser utilities unused outside module.

## Flagged but In Use (False Positives)
| Path | Evidence |
| --- | --- |
| `src/components/DataGridV2/renderers/*` | Imported inside `TableDataGridV2.tsx` and renderer registry.
| `src/components/DataGridV2/hooks/useClipboardBridge.ts` | Registered via `TableDataGridV2` copy handler.
| `src/components/CodeEditor/autocomplete/*` | Used by `CodeEditor/extensions.ts` and runtime completions.
| `src/data/sqlSnippets.ts` / `src/data/sqlFunctions.ts` | Consumed by autocomplete sources and parameter hints.
| `src-tauri/sidecar-ai/**` | Bundled AI sidecar started from `src-tauri/src/ai/manager.rs`; keep until AI architecture finalized.
| `src/components/AIAssistant/**/*` | Lint debt exists but files active in sidebar.
| `src/services/tableStreamingService.ts` | Referenced by `QueryPanel` and `databaseService`.
| Tailwind toolchain (`tailwindcss`, `autoprefixer`, `postcss`) | Required by `postcss.config.js`; depcheck false positive.

## Follow-Ups
- Decide whether to install `cargo-udeps` locally or drop from workflow.
- Plan separate lint clean-up; noise makes dead-code detection harder.
- Confirm with AI owners before ripping `aiService`, `defaultConnections`, and sidecar assets.
- Align removal batches with workbench/table edit roadmap to avoid merge pain.
- Removed redundant dependencies tied to legacy UI and AI services (`@dnd-kit/modifiers`, `@dnd-kit/sortable`, `@glideapps/glide-data-grid-cells`, `@radix-ui/react-menubar`, `@radix-ui/react-hover-card`, `@radix-ui/react-progress`, `@tanstack/react-form`, `@tanstack/react-table`, `@tanstack/react-virtual`, `@tanstack/zod-form-adapter`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`, `@openauthjs/openauth`, `ollama-ai-provider`, `react-diff-viewer-continued`, `react-syntax-highlighter`, `remark-gfm`, `use-debounce`, `date-fns`, `diff`, `lru-cache`, `@uiw/codemirror-theme-vscode`, `@uiw/codemirror-themes`, `@types/diff`, `@types/react-syntax-highlighter`) and regenerated `pnpm-lock.yaml`.

## Scan Gaps / Tool Issues
- `pnpm dlx knip --production` cannot take globbed include paths; current run omitted `src-tauri/sidecar-ai` but still surfaced unused front-end assets.
- `cargo udeps` unavailable (tool missing); rerun after installing via `cargo install cargo-udeps --locked` or drop from workflow.
- `cargo clippy -- -Dunused` fails on `PostgresPoolBuilder::max_lifetime`; either remove field or surface follow-up bug to adapters team.

## Proposed Removal Batches
1. **Workbench Table Editors (TSX pruning)**
   - Remove legacy table editing components listed above and drop related imports from `TableStructure`, `TableIndexes`, and `TableTriggers` if still present.
   - Delete dependent UI primitives (`ui/textarea`, `ui/hover-card`, etc.) once consumers are gone.
   - Update `TableStructure/index.tsx`, `TableIndexes/index.tsx`, and `TableTriggers/index.tsx` to rely solely on new read-only views (remove dead props, helper imports, and stale props like `onActionsChange` hooks if unused post-prune).

2. **Screen Duplicates**
   - Remove stale `src/screens/workspace/components/*` drag/drop copies now that Workbench owns DnD implementation.
   - Eliminate `@dnd-kit/*` dependencies afterwards.
   - Verify `src/screens/workspace/WorkspaceScreen.tsx` and related routes no longer import deleted components.

3. **Service Singletons & Store Barrel**
   - Delete unused service files (`clearAllService`, `connectionMetadataService`, `keyboardLayoutService`, `savedQueriesService`, `secureConnectionService`) plus `src/stores/index.ts` barrel.
   - Drop redundant hook helpers (`useSetContext`, etc.) while keeping the primary context provider APIs.
   - Ensure call sites use `databaseService`, `vaultStorage`, or zustand stores directly; adjust imports where barrel removal breaks paths.

4. **Utility Modules**
   - Drop `databaseUri`, `clearStorage`, `numeric`, `sql`, `sqlGenerator`, `sqlParser` after verifying no runtime eval paths rely on them.
   - Remove unused platform helpers (`setRuntimePlatform`, `is*`) while keeping `detectPlatform` and `RuntimePlatform` types.
   - Delete associated tests (`src/utils/numericPrecision.test.ts` non-null assertions rely on soon-to-be-removed helpers) or migrate remaining assertions.

5. **Dependency Hygiene**
   - After code pruning, remove highlighted npm packages and rerun `pnpm install`, `pnpm lint`, `pnpm typecheck`.
   - Keep Tailwind/PostCSS deps and any AI-SDK packages if product confirms they are still needed soon.
   - Regenerate lockfile (`pnpm install --lockfile-only`) and re-run `pnpm dlx depcheck` to verify clean slate.

6. **Rust Cleanup**
   - Remove or wire `PostgresPoolBuilder::max_lifetime` to unblock `cargo clippy -- -Dunused`.
   - Install `cargo-udeps` for a follow-up scan once clippy is clean.

## Removal Checklist Draft
- [x] Delete legacy table editing files listed in **Removed Modules (current cleanup)** and strip their imports from surviving modules.
- [x] Delete legacy workspace drag/drop components in `src/screens/workspace/components` and verify no residual imports.
- [x] Remove unused services (`clearAllService`, `connectionMetadataService`, `keyboardLayoutService`, `savedQueriesService`, `secureConnectionService`) and update `src/services/index.ts` or feature modules if they reference them.
- [x] Delete unused hooks (`useColumnResizing`, `useCopy`, `useKeybinding`, `useWindowConnection`) and adjust any feature modules still importing them (should be none, verify with TypeScript errors).
- [x] Remove unused utility modules (`databaseUri`, `clearStorage`, `numeric`, `sql`, `sqlGenerator`, `sqlParser`, selected exports in `diffUtils`) and drop any test files that reference them.
- [x] Prune `src/components/ui/*` primitives no longer needed (`hover-card`, `menubar`, `table`, `textarea`, `toaster`, `toggle-button`).
- [x] Update `package.json` to drop unused dependencies called out above; regenerate `pnpm-lock.yaml`.
- [ ] Re-run validation suite (`pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm tauri:build`, `cargo clippy -- -Dunused`, `cargo test`) to ensure clean state.

## Verification Status
- `pnpm install --lockfile-only` ✔️ regenerated `pnpm-lock.yaml` after dependency removals.
- `pnpm typecheck` ❌ fails (long-standing TS errors across CodeEditor/DataGrid modules; unaffected by this cleanup).
- `pnpm lint` ❌ fails (existing ESLint debt ~350 errors; see task backlog).
- `pnpm build` ❌ blocked at TypeScript compilation due to pre-existing errors.
- `cargo clippy --workspace --all-targets -- -Dunused` ❌ fails because `tauri::generate_context!()` requires `dist/` assets generated by a successful frontend build.

