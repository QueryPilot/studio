/**
 * Editor Registry Service
 *
 * Global registry for SQL editors to enable AI/command integration.
 * Editors register themselves when they become focused and can be queried
 * for their content and selection from commands and AI features.
 */

import type { SqlEditorRef } from "@/components/CodeEditor/SqlEditor";

interface RegisteredEditor {
  /**
   * Unique ID for this editor instance (typically panelId or tabId)
   */
  id: string;

  /**
   * Connection ID for database context
   */
  connectionId: string;

  /**
   * Database name for context
   */
  database: string;

  /**
   * Schema name for context
   */
  schema: string;

  /**
   * Function to get the editor ref (may return null if unmounted)
   */
  getRef: () => SqlEditorRef | null;
}

class EditorRegistry {
  private focusedEditorId: string | null = null;
  private registeredEditors = new Map<string, RegisteredEditor>();

  /**
   * Register an editor with the registry
   */
  register(editor: RegisteredEditor): void {
    this.registeredEditors.set(editor.id, editor);
  }

  /**
   * Unregister an editor from the registry
   */
  unregister(editorId: string): void {
    this.registeredEditors.delete(editorId);
    if (this.focusedEditorId === editorId) {
      this.focusedEditorId = null;
    }
  }

  /**
   * Set the currently focused editor
   */
  setFocusedEditor(editorId: string): void {
    if (this.registeredEditors.has(editorId)) {
      this.focusedEditorId = editorId;
    }
  }

  /**
   * Clear the focused editor (called when an editor loses focus)
   */
  clearFocusedEditor(editorId: string): void {
    if (this.focusedEditorId === editorId) {
      this.focusedEditorId = null;
    }
  }

  /**
   * Get the currently focused editor info
   */
  getFocusedEditor(): RegisteredEditor | null {
    if (!this.focusedEditorId) {
      return null;
    }
    return this.registeredEditors.get(this.focusedEditorId) ?? null;
  }

  /**
   * Get the content of the focused editor
   * Returns the selection if there is one, otherwise the full content
   */
  getActiveContent(): { sql: string; isSelection: boolean } | null {
    const editor = this.getFocusedEditor();
    if (!editor) {
      return null;
    }

    const ref = editor.getRef();
    if (!ref) {
      return null;
    }

    // First check for selection
    const selection = ref.getSelection();
    if (selection && selection.trim().length > 0) {
      return { sql: selection.trim(), isSelection: true };
    }

    // Fall back to full content
    const fullContent = ref.getValue();
    if (fullContent && fullContent.trim().length > 0) {
      return { sql: fullContent.trim(), isSelection: false };
    }

    return null;
  }

  /**
   * Get the database context for the focused editor
   */
  getActiveContext(): {
    connectionId: string;
    database: string;
    schema: string;
  } | null {
    const editor = this.getFocusedEditor();
    if (!editor) {
      return null;
    }

    return {
      connectionId: editor.connectionId,
      database: editor.database,
      schema: editor.schema,
    };
  }
}

// Singleton instance
export const editorRegistry = new EditorRegistry();
