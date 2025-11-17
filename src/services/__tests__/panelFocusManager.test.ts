import { describe, it, expect, afterEach } from "vitest";

import { panelFocusManager } from "@/services/panelFocusManager";

function createPanelRoot(id: string): HTMLDivElement {
  const root = document.createElement("div");
  root.dataset.testid = id;
  root.tabIndex = -1;
  document.body.appendChild(root);
  return root;
}

const flushFocus = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("panelFocusManager", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    panelFocusManager.resetForTesting();
  });

  it("focuses registered default target when syncing active panel", async () => {
    const panelId = "panel-alpha";
    const root = createPanelRoot(panelId);
    const input = document.createElement("input");
    root.appendChild(input);

    panelFocusManager.registerPanelRoot(panelId, () => root);
    panelFocusManager.registerDefaultTarget(panelId, () => input, {
      id: "alpha-input",
    });

    panelFocusManager.syncActivePanel(panelId);
    await flushFocus();

    expect(document.activeElement).toBe(input);
  });

  it("restores the last focused element across panel switches", async () => {
    const panelA = "panel-a";
    const panelB = "panel-b";
    const rootA = createPanelRoot(panelA);
    const rootB = createPanelRoot(panelB);
    const inputA = document.createElement("button");
    const inputB = document.createElement("input");
    rootA.appendChild(inputA);
    rootB.appendChild(inputB);

    panelFocusManager.registerPanelRoot(panelA, () => rootA);
    panelFocusManager.registerPanelRoot(panelB, () => rootB);
    panelFocusManager.recordFocus(panelA, inputA);
    panelFocusManager.recordFocus(panelB, inputB);

    panelFocusManager.syncActivePanel(panelA);
    await flushFocus();
    expect(document.activeElement).toBe(inputA);

    panelFocusManager.syncActivePanel(panelB);
    await flushFocus();
    expect(document.activeElement).toBe(inputB);
  });

  it("prevents panel-scoped shortcuts from firing when another panel is focused", () => {
    const panelActive = "panel-active";
    const panelInactive = "panel-inactive";
    const rootActive = createPanelRoot(panelActive);
    const rootInactive = createPanelRoot(panelInactive);
    const focusable = document.createElement("input");
    rootActive.appendChild(focusable);

    panelFocusManager.registerPanelRoot(panelActive, () => rootActive);
    panelFocusManager.registerPanelRoot(panelInactive, () => rootInactive);
    panelFocusManager.recordFocus(panelActive, focusable);
    panelFocusManager.syncActivePanel(panelActive);

    focusable.focus();

    expect(panelFocusManager.shouldHandleShortcut(panelActive)).toBe(true);
    expect(panelFocusManager.shouldHandleShortcut(panelInactive)).toBe(false);
  });
});
