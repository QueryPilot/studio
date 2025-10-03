import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface KeyboardContext {
  editorFocus: boolean;
  queryPanelActive: boolean;
  tablePanelActive: boolean;
  hasUnsavedChanges: boolean;
  isExecuting: boolean;
  cellSelected: boolean;
  isEditing: boolean;
}

interface KeyboardStore {
  context: KeyboardContext;
  updateContext: (context: Partial<KeyboardContext>) => void;
  setContextValue: (key: keyof KeyboardContext, value: boolean) => void;
}

export const useKeyboardStore = create<KeyboardStore>()(
  devtools(
    (set) => ({
      context: {
        editorFocus: false,
        queryPanelActive: false,
        tablePanelActive: false,
        hasUnsavedChanges: false,
        isExecuting: false,
        cellSelected: false,
        isEditing: false,
      },
      updateContext: (context) =>
        { set((state) => ({
          context: { ...state.context, ...context },
        })); },
      setContextValue: (key, value) =>
        { set((state) => ({
          context: { ...state.context, [key]: value },
        })); },
    }),
    {
      name: 'keyboard-store',
    }
  )
);