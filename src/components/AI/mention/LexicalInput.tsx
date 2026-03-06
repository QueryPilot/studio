import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
} from "lexical";
import type { EditorState, LexicalEditor } from "lexical";

import type { AIContext } from "@/types/aiContext";
import { cn } from "@/lib/utils";

import { MentionNode } from "./MentionNode";
import { MentionPlugin } from "./MentionPlugin";

// =============================================================================
// Imperative handle
// =============================================================================

export interface LexicalInputHandle {
  focus: () => void;
  clear: () => void;
  setText: (text: string) => void;
}

// =============================================================================
// Props
// =============================================================================

interface LexicalInputProps {
  value: string; // not used to control editor (one-way out via onChange)
  onChange: (text: string) => void;
  onSubmit: () => void;
  onNewConversation?: () => void;
  onPaste?: (event: ClipboardEvent) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  aiContext: AIContext;
  openTabs: Array<{ id: string; name: string; type: string; panelId: string }>;
  focusedConnectionId?: string;
}

// =============================================================================
// Inline plugins
// =============================================================================

function EditorRefPlugin({
  editorRef,
}: {
  editorRef: React.RefObject<LexicalEditor | null>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);
  return null;
}

function SubmitPlugin({ onSubmit }: { onSubmit: () => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event?.shiftKey) return false;
        event?.preventDefault();
        onSubmit();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, onSubmit]);

  return null;
}

function PastePlugin({
  onPaste,
}: {
  onPaste?: (event: ClipboardEvent) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onPaste) return;

    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    rootElement.addEventListener("paste", onPaste);
    return () => {
      rootElement.removeEventListener("paste", onPaste);
    };
  }, [editor, onPaste]);

  return null;
}

function AutoFocusPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.focus();
  }, [editor]);

  return null;
}

function KeyboardShortcutPlugin({
  onNewConversation,
}: {
  onNewConversation?: () => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onNewConversation) return;

    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        onNewConversation();
      }
    };

    rootElement.addEventListener("keydown", handler);
    return () => {
      rootElement.removeEventListener("keydown", handler);
    };
  }, [editor, onNewConversation]);

  return null;
}

function EditablePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(editable);
  }, [editor, editable]);

  return null;
}

// =============================================================================
// Helpers
// =============================================================================

function editorStateToText(editorState: EditorState): string {
  return editorState.read(() => $getRoot().getTextContent());
}

// =============================================================================
// Component
// =============================================================================

export const LexicalInput = forwardRef<LexicalInputHandle, LexicalInputProps>(
  function LexicalInput(
    {
      // value is intentionally unused — one-way out via onChange
      value: _value,
      onChange,
      onSubmit,
      onNewConversation,
      onPaste,
      placeholder = "",
      disabled = false,
      className,
      aiContext,
      openTabs,
      focusedConnectionId,
    },
    ref,
  ) {
    const editorRef = useRef<LexicalEditor | null>(null);

    const handleChange = useCallback(
      (editorState: EditorState) => {
        onChange(editorStateToText(editorState));
      },
      [onChange],
    );

    useImperativeHandle(ref, () => ({
      focus: () => {
        editorRef.current?.focus();
      },
      clear: () => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          root.append($createParagraphNode());
        });
      },
      setText: (text: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode(text));
          root.append(paragraph);
        });
      },
    }));

    const initialConfig = {
      namespace: "AIPromptInput",
      theme: { paragraph: "mb-0" },
      nodes: [MentionNode],
      editable: !disabled,
      onError: (error: Error) => {
        console.error("LexicalInput error:", error);
      },
    };

    return (
      <div className="relative">
        <LexicalComposer initialConfig={initialConfig}>
          <EditorRefPlugin editorRef={editorRef} />
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                className={cn(
                  "min-h-[48px] max-h-[160px] w-full resize-none overflow-y-auto px-4 pt-3 pb-2 text-[13px] outline-none",
                  className,
                )}
              />
            }
            placeholder={
              <div className="pointer-events-none absolute top-3 left-4 text-[13px] text-muted-foreground/50">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
          <HistoryPlugin />
          <SubmitPlugin onSubmit={onSubmit} />
          <PastePlugin onPaste={onPaste} />
          <AutoFocusPlugin />
          <KeyboardShortcutPlugin onNewConversation={onNewConversation} />
          <EditablePlugin editable={!disabled} />
          <MentionPlugin
            aiContext={aiContext}
            openTabs={openTabs}
            focusedConnectionId={focusedConnectionId}
          />
        </LexicalComposer>
      </div>
    );
  },
);
