/**
 * High-Performance CodeMirror 6 Editor
 *
 * Direct CodeMirror 6 integration without React wrapper overhead.
 * Uses uncontrolled pattern for maximum performance.
 *
 * Key optimizations:
 * - No controlled value prop - CM6 manages its own state
 * - Minimal React re-renders - only on prop changes
 * - Extension compartments for dynamic updates
 * - Debounced callbacks to prevent cascade updates
 */

import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
  memo,
} from "react";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { debounce } from "@/utils/debounce";

export interface EditorRef {
  view: EditorView | null;
  focus: () => void;
  blur: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
  getSelection: () => string;
  replaceSelection: (text: string) => void;
  getCursorPosition: () => number;
  setCursorPosition: (pos: number) => void;
  revealLine: (line: number) => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
}

export interface EditorProps {
  /** Initial value - only used on mount, not controlled */
  initialValue?: string;
  /** Called on document changes (debounced) */
  onChange?: (value: string) => void;
  /** Debounce delay for onChange in ms (default: 0 for immediate) */
  onChangeDelay?: number;
  /** Called on selection changes */
  onSelectionChange?: (selection: { from: number; to: number; text: string }) => void;
  /** Called when editor gains focus */
  onFocus?: () => void;
  /** Called when editor loses focus */
  onBlur?: () => void;
  /** Extensions to add to the editor */
  extensions?: Extension[];
  /** Placeholder text */
  placeholder?: string;
  /** Whether editor is read-only */
  readOnly?: boolean;
  /** Auto-focus on mount */
  autoFocus?: boolean;
  /** CSS class name */
  className?: string;
  /** Height style */
  height?: string;
  /** Min height style */
  minHeight?: string;
  /** Max height style */
  maxHeight?: string;
}

// Compartments for dynamic extension updates
const readOnlyCompartment = new Compartment();
const placeholderCompartment = new Compartment();
const extensionsCompartment = new Compartment();

const baseTheme = EditorView.theme({
  "&": {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  ".cm-editor": {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  ".cm-scroller": {
    overflow: "auto",
    flex: "1",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: "13px",
    lineHeight: "1.5",
  },
  ".cm-content": {
    minHeight: "100%",
    caretColor: "#FCA311",
  },
  ".cm-gutters": {
    minHeight: "100%",
  },
  ".cm-cursor": {
    borderLeftColor: "#FCA311",
    borderLeftWidth: "2px",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(252, 163, 17, 0.2) !important",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(252, 163, 17, 0.3) !important",
  },
});

export const Editor = memo(
  forwardRef<EditorRef, EditorProps>(function Editor(
    {
      initialValue = "",
      onChange,
      onChangeDelay = 0,
      onSelectionChange,
      onFocus,
      onBlur,
      extensions = [],
      placeholder = "",
      readOnly = false,
      autoFocus = false,
      className = "",
      height = "100%",
      minHeight,
      maxHeight,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onFocusRef = useRef(onFocus);
    const onBlurRef = useRef(onBlur);

    // Keep callback refs updated
    onChangeRef.current = onChange;
    onSelectionChangeRef.current = onSelectionChange;
    onFocusRef.current = onFocus;
    onBlurRef.current = onBlur;

    // Create debounced onChange handler
    const debouncedOnChange = useCallback(
      debounce((value: string) => {
        onChangeRef.current?.(value);
      }, onChangeDelay),
      [onChangeDelay]
    );

    // Expose imperative handle
    useImperativeHandle(
      ref,
      () => ({
        view: viewRef.current,
        focus: () => viewRef.current?.focus(),
        blur: () => viewRef.current?.contentDOM.blur(),
        getValue: () => viewRef.current?.state.doc.toString() || "",
        setValue: (value: string) => {
          const view = viewRef.current;
          if (!view) return;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: value },
          });
        },
        getSelection: () => {
          const view = viewRef.current;
          if (!view) return "";
          const { from, to } = view.state.selection.main;
          return view.state.doc.sliceString(from, to);
        },
        replaceSelection: (text: string) => {
          const view = viewRef.current;
          if (!view) return;
          view.dispatch(view.state.replaceSelection(text));
        },
        getCursorPosition: () => {
          return viewRef.current?.state.selection.main.head || 0;
        },
        setCursorPosition: (pos: number) => {
          const view = viewRef.current;
          if (!view) return;
          view.dispatch({ selection: { anchor: pos } });
        },
        revealLine: (lineNumber: number) => {
          const view = viewRef.current;
          if (!view) return;
          try {
            const line = view.state.doc.line(lineNumber);
            view.dispatch({
              selection: { anchor: line.from, head: line.to },
              effects: EditorView.scrollIntoView(line.from, {
                y: "center",
                yMargin: 100,
              }),
            });
            view.focus();
          } catch {
            // Invalid line number
          }
        },
        scrollToTop: () => {
          viewRef.current?.dispatch({
            effects: EditorView.scrollIntoView(0, { y: "start" }),
          });
        },
        scrollToBottom: () => {
          const view = viewRef.current;
          if (!view) return;
          view.dispatch({
            effects: EditorView.scrollIntoView(view.state.doc.length, { y: "end" }),
          });
        },
      }),
      []
    );

    // Initialize editor
    useEffect(() => {
      if (!containerRef.current) return;

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const value = update.state.doc.toString();
          if (onChangeDelay > 0) {
            debouncedOnChange(value);
          } else {
            onChangeRef.current?.(value);
          }
        }

        if (update.selectionSet && onSelectionChangeRef.current) {
          const { from, to } = update.state.selection.main;
          onSelectionChangeRef.current({
            from,
            to,
            text: update.state.doc.sliceString(from, to),
          });
        }

        if (update.focusChanged) {
          if (update.view.hasFocus) {
            onFocusRef.current?.();
          } else {
            onBlurRef.current?.();
          }
        }
      });

      const state = EditorState.create({
        doc: initialValue,
        extensions: [
          // Base extensions
          baseTheme,
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),

          // Dynamic compartments
          readOnlyCompartment.of(EditorView.editable.of(!readOnly)),
          placeholderCompartment.of(placeholder ? placeholderExt(placeholder) : []),
          extensionsCompartment.of(extensions),

          // Update listener
          updateListener,
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;

      if (autoFocus) {
        // Small delay to ensure DOM is ready
        requestAnimationFrame(() => view.focus());
      }

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, []); // Empty deps - only run on mount

    // Update read-only state
    useEffect(() => {
      viewRef.current?.dispatch({
        effects: readOnlyCompartment.reconfigure(EditorView.editable.of(!readOnly)),
      });
    }, [readOnly]);

    // Update placeholder
    useEffect(() => {
      viewRef.current?.dispatch({
        effects: placeholderCompartment.reconfigure(
          placeholder ? placeholderExt(placeholder) : []
        ),
      });
    }, [placeholder]);

    // Update extensions
    useEffect(() => {
      viewRef.current?.dispatch({
        effects: extensionsCompartment.reconfigure(extensions),
      });
    }, [extensions]);

    const style: React.CSSProperties = {
      height,
      minHeight,
      maxHeight,
      display: "flex",
      flexDirection: "column",
    };

    return (
      <div
        ref={containerRef}
        className={`editor-container ${className}`}
        style={style}
      />
    );
  })
);

Editor.displayName = "Editor";
