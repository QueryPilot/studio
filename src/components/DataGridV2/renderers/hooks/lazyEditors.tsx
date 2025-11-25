import React, { Suspense, useEffect } from "react";
import { IconLoader2 } from "@tabler/icons-react";

/**
 * Loading skeleton for cell editors
 */
const EditorLoadingSkeleton: React.FC<{ minHeight?: number }> = ({ 
  minHeight = 100 
}) => (
  <div 
    className="w-full flex items-center justify-center bg-popover border border-border rounded-lg"
    style={{ minHeight }}
  >
    <div className="flex items-center gap-2 text-muted-foreground text-xs">
      <IconLoader2 className="h-4 w-4 animate-spin" />
      <span>Loading editor...</span>
    </div>
  </div>
);

// Track which editors have been preloaded
const preloadedEditors = new Set<string>();

// Lazy-loaded editor modules with chunk names for better debugging
const lazyEditorModules = {
  json: () => import("../JSONCell/JSONCellEditor" /* webpackChunkName: "editor-json" */),
  datetime: () => import("../DateTimeCell/DateTimeCellEditor" /* webpackChunkName: "editor-datetime" */),
  datetimeRange: () => import("../DateTimeCell/DateTimeRangeCellEditor" /* webpackChunkName: "editor-datetime-range" */),
  hstore: () => import("../HStoreCell/HStoreCellEditor" /* webpackChunkName: "editor-hstore" */),
} as const;

type EditorKey = keyof typeof lazyEditorModules;

/**
 * Preload an editor module (call on cell hover for predictive loading)
 */
export function preloadEditor(editorKey: EditorKey): void {
  if (preloadedEditors.has(editorKey)) return;
  
  preloadedEditors.add(editorKey);
  lazyEditorModules[editorKey]().catch(() => {
    // Remove from set on failure so it can be retried
    preloadedEditors.delete(editorKey);
  });
}

/**
 * Check if an editor has been preloaded
 */
export function isEditorPreloaded(editorKey: EditorKey): boolean {
  return preloadedEditors.has(editorKey);
}

// Lazy-loaded editor components
const LazyJsonCellEditor = React.lazy(() => 
  lazyEditorModules.json().then(m => ({ default: m.JsonCellEditor }))
);

const LazyDateTimeCellEditor = React.lazy(() => 
  lazyEditorModules.datetime().then(m => ({ default: m.DateTimeCellEditor }))
);

const LazyDateTimeRangeCellEditor = React.lazy(() => 
  lazyEditorModules.datetimeRange().then(m => ({ default: m.DateTimeRangeCellEditor }))
);

const LazyHStoreCellEditor = React.lazy(() => 
  lazyEditorModules.hstore().then(m => ({ default: m.HStoreCellEditor }))
);

/**
 * Lazy-loaded JSON Cell Editor with Suspense boundary
 */
export const LazyJsonCellEditorWithProps: React.FC<any> = (props) => (
  <Suspense fallback={<EditorLoadingSkeleton minHeight={300} />}>
    <LazyJsonCellEditor {...props} />
  </Suspense>
);

// Attach glide-data-grid required properties
Object.assign(LazyJsonCellEditorWithProps, {
  disablePadding: true,
  disableStyling: false,
});

/**
 * Lazy-loaded DateTime Cell Editor with Suspense boundary
 */
export const LazyDateTimeCellEditorWithProps: React.FC<any> = (props) => (
  <Suspense fallback={<EditorLoadingSkeleton minHeight={80} />}>
    <LazyDateTimeCellEditor {...props} />
  </Suspense>
);

Object.assign(LazyDateTimeCellEditorWithProps, {
  disablePadding: true,
  disableStyling: false,
});

/**
 * Lazy-loaded DateTimeRange Cell Editor with Suspense boundary
 */
export const LazyDateTimeRangeCellEditorWithProps: React.FC<any> = (props) => (
  <Suspense fallback={<EditorLoadingSkeleton minHeight={120} />}>
    <LazyDateTimeRangeCellEditor {...props} />
  </Suspense>
);

Object.assign(LazyDateTimeRangeCellEditorWithProps, {
  disablePadding: true,
  disableStyling: false,
});

/**
 * Lazy-loaded HStore Cell Editor with Suspense boundary
 */
export const LazyHStoreCellEditorWithProps: React.FC<any> = (props) => (
  <Suspense fallback={<EditorLoadingSkeleton minHeight={180} />}>
    <LazyHStoreCellEditor {...props} />
  </Suspense>
);

Object.assign(LazyHStoreCellEditorWithProps, {
  disablePadding: true,
  disableStyling: false,
});

/**
 * Hook to preload editor on cell hover (for predictive loading)
 * Call this with the editor type when a cell is hovered
 */
export function usePreloadEditorOnHover(
  editorKey: EditorKey | null,
  enabled: boolean = true
): void {
  useEffect(() => {
    if (!enabled || !editorKey) return;
    
    // Small delay to avoid preloading on quick mouse movements
    const timer = setTimeout(() => {
      preloadEditor(editorKey);
    }, 100);

    return () => clearTimeout(timer);
  }, [editorKey, enabled]);
}

