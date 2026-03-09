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

import { useEffect, useRef, useState } from "react";
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
  viewReadyVersion = 0,
) {
  const [compartments] = useState(() => ({
    phase1: new Compartment(),
    phase2: new Compartment(),
  }));
  const phaseStateRef = useRef({
    phase1Loaded: false,
    phase2Loaded: false,
  });

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const applyPhase1 = () => {
      if (!viewRef.current) return;
      viewRef.current.dispatch({
        effects: compartments.phase1.reconfigure(phase1Extensions),
      });
      phaseStateRef.current.phase1Loaded = true;
    };

    const applyPhase2 = () => {
      if (!viewRef.current) return;
      viewRef.current.dispatch({
        effects: compartments.phase2.reconfigure(phase2Extensions),
      });
      phaseStateRef.current.phase2Loaded = true;
    };

    if (phaseStateRef.current.phase1Loaded) {
      applyPhase1();
      if (phaseStateRef.current.phase2Loaded) {
        applyPhase2();
        return;
      }
    }

    if (phaseStateRef.current.phase2Loaded) {
      applyPhase2();
      return;
    }

    // Phase 1: After first render (next rAF)
    const rafId = requestAnimationFrame(() => {
      applyPhase1();
    });

    // Phase 2: Eventually (after 2s idle)
    const timeoutId = setTimeout(() => {
      applyPhase2();
    }, 2000);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [viewRef, phase1Extensions, phase2Extensions, compartments, viewReadyVersion]);

  return compartments;
}
