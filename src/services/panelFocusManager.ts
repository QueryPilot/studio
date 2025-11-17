export type PanelFocusHandle =
  | HTMLElement
  | {
      focus: (options?: FocusOptions) => void;
    };

interface FocusTarget {
  id: string;
  panelId: string;
  priority: number;
  getHandle: () => PanelFocusHandle | null | undefined;
}

type PanelId = string;

const isBrowser =
  typeof window !== "undefined" && typeof document !== "undefined";

let focusTargetCounter = 0;

export class PanelFocusManager {
  private activePanelId: PanelId | null = null;
  private panelRoots = new Map<PanelId, () => HTMLElement | null>();
  private lastFocusedElement = new Map<PanelId, HTMLElement>();
  private defaultTargets = new Map<PanelId, FocusTarget[]>();
  private rafId: number | null = null;

  registerPanelRoot(
    panelId: PanelId,
    getRoot: () => HTMLElement | null,
  ): () => void {
    this.panelRoots.set(panelId, getRoot);
    return () => {
      const current = this.panelRoots.get(panelId);
      if (current === getRoot) {
        this.panelRoots.delete(panelId);
        this.lastFocusedElement.delete(panelId);
        this.defaultTargets.delete(panelId);
        if (this.activePanelId === panelId) {
          this.activePanelId = null;
        }
      }
    };
  }

  registerDefaultTarget(
    panelId: PanelId,
    getHandle: () => PanelFocusHandle | null | undefined,
    options?: {
      priority?: number;
      id?: string;
    },
  ): () => void {
    const target: FocusTarget = {
      id:
        options?.id ??
        `panel-focus-target-${panelId}-${focusTargetCounter++}`,
      panelId,
      priority: options?.priority ?? 0,
      getHandle,
    };
    const targets = this.defaultTargets.get(panelId) ?? [];
    targets.push(target);
    targets.sort((a, b) => a.priority - b.priority);
    this.defaultTargets.set(panelId, targets);

    return () => {
      const currentTargets = this.defaultTargets.get(panelId);
      if (!currentTargets) return;
      const nextTargets = currentTargets.filter((t) => t !== target);
      if (nextTargets.length === 0) {
        this.defaultTargets.delete(panelId);
      } else {
        this.defaultTargets.set(panelId, nextTargets);
      }
    };
  }

  recordFocus(panelId: PanelId, element: HTMLElement): void {
    if (!isBrowser) return;
    if (!this.isElementWithinPanel(element, panelId)) {
      return;
    }
    this.lastFocusedElement.set(panelId, element);
  }

  syncActivePanel(panelId: PanelId | null): void {
    this.activePanelId = panelId;
    if (!panelId) {
      return;
    }

    this.focusPanel(panelId);

    if (!isBrowser || typeof window.requestAnimationFrame !== "function") {
      return;
    }

    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
    }
    this.rafId = window.requestAnimationFrame(() => {
      this.focusPanel(panelId);
      this.rafId = null;
    });
  }

  shouldHandleShortcut(panelId?: PanelId | null): boolean {
    if (!panelId) {
      return true;
    }
    if (!isBrowser) {
      return true;
    }

    if (this.activePanelId && this.activePanelId !== panelId) {
      return false;
    }

    const activeElement = document.activeElement as Element | null;
    return this.isElementWithinPanel(activeElement, panelId);
  }

  isElementWithinPanel(element: Element | null, panelId: PanelId): boolean {
    if (!element) return false;
    const rootGetter = this.panelRoots.get(panelId);
    const root = rootGetter?.();
    if (root && root.contains(element)) {
      return true;
    }
    return false;
  }

  getCurrentPanelId(): PanelId | null {
    return this.activePanelId;
  }

  resetForTesting(): void {
    if (this.rafId && isBrowser) {
      window.cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.activePanelId = null;
    this.panelRoots.clear();
    this.lastFocusedElement.clear();
    this.defaultTargets.clear();
  }

  private focusPanel(panelId: PanelId): boolean {
    if (this.focusLastKnownElement(panelId)) {
      return true;
    }
    if (this.focusDefaultTargets(panelId)) {
      return true;
    }
    const root = this.panelRoots.get(panelId)?.();
    if (root) {
      this.safeFocus(root);
      return true;
    }
    return false;
  }

  private focusLastKnownElement(panelId: PanelId): boolean {
    const element = this.lastFocusedElement.get(panelId);
    if (!element) {
      return false;
    }
    if (!this.isElementWithinPanel(element, panelId)) {
      this.lastFocusedElement.delete(panelId);
      return false;
    }
    return this.safeFocus(element);
  }

  private focusDefaultTargets(panelId: PanelId): boolean {
    const targets = this.defaultTargets.get(panelId);
    if (!targets || targets.length === 0) {
      return false;
    }
    for (const target of targets) {
      const handle = target.getHandle();
      if (!handle) continue;
      if (this.safeFocus(handle)) {
        if (handle instanceof HTMLElement) {
          this.lastFocusedElement.set(panelId, handle);
        }
        return true;
      }
    }
    return false;
  }

  private safeFocus(
    target: PanelFocusHandle,
    options: FocusOptions = { preventScroll: true },
  ): boolean {
    try {
      if (target instanceof HTMLElement) {
        target.focus(options);
      } else {
        target.focus();
      }
      return true;
    } catch (error) {
      console.warn("[panelFocusManager] Failed to focus target", error);
      return false;
    }
  }
}

export const panelFocusManager = new PanelFocusManager();
