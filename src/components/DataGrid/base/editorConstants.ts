/** Selector matching all grid editor overlay elements */
export const GRID_EDITOR_SELECTOR =
  '[data-slot="grid-editor"], .gdg-editor-shell, .click-outside-ignore';

/** Check if an element is inside a grid editor overlay */
export const isEditorOverlayElement = (element: EventTarget | null): boolean => {
  if (!(element instanceof Element)) return false;
  return Boolean(element.closest(GRID_EDITOR_SELECTOR));
};
