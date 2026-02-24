/**
 * Extension Phasing Hook
 *
 * Phases CodeMirror extensions into an already-mounted editor to improve
 * initial render performance. Extensions are split into:
 *   - Eager: loaded in EditorState.create (handled by caller)
 *   - Phase 1 (AfterFirstRender): loaded after first rAF (~16ms)
 *   - Phase 2 (Eventually): loaded after 2 seconds idle
 *
 * The caller must include `compartments.phase1.of([])` and
 * `compartments.phase2.of([])` as placeholders in the initial extensions.
 */

import { useEffect, useRef } from "react";
import { type EditorView } from "@codemirror/view";
import { Compartment, type Extension } from "@codemirror/state";

/**
 * Phases extensions into an already-mounted editor.
 * Phase 1 (AfterFirstRender): Added after first rAF (~16ms)
 * Phase 2 (Eventually): Added after 2 seconds idle
 */
export function useExtensionPhasing(
  viewRef: React.RefObject<EditorView | null>,
  phase1Extensions: Extension[],
  phase2Extensions: Extension[],
) {
  const compartmentRef = useRef({
    phase1: new Compartment(),
    phase2: new Compartment(),
  });

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    // Phase 1: After first render (next rAF)
    const rafId = requestAnimationFrame(() => {
      if (!viewRef.current) return;
      viewRef.current.dispatch({
        effects: compartmentRef.current.phase1.reconfigure(phase1Extensions),
      });
    });

    // Phase 2: Eventually (after 2s idle)
    const timeoutId = setTimeout(() => {
      if (!viewRef.current) return;
      viewRef.current.dispatch({
        effects: compartmentRef.current.phase2.reconfigure(phase2Extensions),
      });
    }, 2000);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, []); // Only on mount — extensions are phased once

  return compartmentRef.current;
}
