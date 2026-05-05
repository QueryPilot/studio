/**
 * Feature flags for the AI subsystem.
 *
 * Flip these to disable a feature without ripping out its code paths.
 */

/**
 * BYOK (Bring Your Own Key) — direct provider integration via the AI SDK.
 *
 * When `false`:
 *   - The runtime-mode toggle in AI Preferences hides the BYOK option.
 *   - `AIPanel` short-circuits every BYOK branch (no provider selector,
 *     no `byokSendMessage`, no per-connection history clear).
 *   - `CompactModelPicker` renders nothing.
 *
 * The byokStore and `@/ai/service` code stay in the bundle so re-enabling
 * is a one-line flip. If you need to ship without the dependency at all,
 * also remove the `useByokStore` imports from AIPanel/AIPreferencesPanel.
 */
// Annotated as `boolean` (not `false`) so TS doesn't narrow every guarded
// branch to dead code — that would trip `no-unnecessary-condition` lint
// errors at every call site and force this flag to be treated as a
// literal-type instead of a runtime toggle.
export const BYOK_ENABLED: boolean = false;
