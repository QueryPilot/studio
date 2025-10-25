import { useEffect, useRef } from "react";

/**
 * Ensures pending edits are committed if the editor unmounts
 * without explicitly calling onFinishedEditing (e.g. click outside).
 */
export function useCommitOnUnmount(
  finishedRef: { current: boolean },
  commit: () => void,
) {
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const skipStrictCleanupRef = useRef(import.meta.env.DEV);

  useEffect(() => {
    const finishedRefSnapshot = finishedRef;
    return () => {
      // React 18 StrictMode runs effects twice (mount → cleanup → mount).
      // Skip the first cleanup so we don't commit during the dev-only cycle.
      if (skipStrictCleanupRef.current) {
        skipStrictCleanupRef.current = false;
        return;
      }
      if (!finishedRefSnapshot.current) {
        commitRef.current();
      }
    };
  }, [finishedRef]);
}
