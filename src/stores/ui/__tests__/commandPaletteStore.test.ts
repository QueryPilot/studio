import { describe, it, expect, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useCommandPaletteStore } from "../commandPaletteStore";

describe("commandPaletteStore", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    const store = useCommandPaletteStore.getState();
    store.closePalette();
  });

  describe("basic functionality", () => {
    it("should initialize with closed state", () => {
      const state = useCommandPaletteStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.query).toBe("");
    });

    it("should open palette", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.openPalette();
      });

      const state = useCommandPaletteStore.getState();
      expect(state.isOpen).toBe(true);
    });

    it("should close palette and reset query", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.openPalette();
        store.setQuery("test");
        store.closePalette();
      });

      const state = useCommandPaletteStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.query).toBe("");
    });

    it("should update query", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.setQuery("search term");
      });

      const state = useCommandPaletteStore.getState();
      expect(state.query).toBe("search term");
    });
  });

  describe("nestedMode", () => {
    it("should initialize with null nestedMode", () => {
      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toBeNull();
    });

    it("should set nested mode to switch-database", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.setNestedMode({ type: "switch-database" });
      });

      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toEqual({ type: "switch-database" });
    });

    it("should set nested mode to switch-schema", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.setNestedMode({ type: "switch-schema" });
      });

      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toEqual({ type: "switch-schema" });
    });

    it("should set nested mode to open-connection", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.setNestedMode({ type: "open-connection" });
      });

      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toEqual({ type: "open-connection" });
    });

    it("should clear query when setting nested mode", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.setQuery("some query");
        store.setNestedMode({ type: "switch-database" });
      });

      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toEqual({ type: "switch-database" });
      expect(state.query).toBe("");
    });

    it("should exit nested mode", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.setNestedMode({ type: "switch-schema" });
        store.exitNestedMode();
      });

      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toBeNull();
    });

    it("should clear query when exiting nested mode", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.setNestedMode({ type: "switch-schema" });
        store.setQuery("public");
        store.exitNestedMode();
      });

      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toBeNull();
      expect(state.query).toBe("");
    });

    it("should reset nestedMode when closing palette", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.openPalette();
        store.setNestedMode({ type: "open-connection" });
        store.closePalette();
      });

      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toBeNull();
      expect(state.isOpen).toBe(false);
    });

    it("should reset nestedMode when opening palette", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.setNestedMode({ type: "switch-database" });
        store.openPalette();
      });

      const state = useCommandPaletteStore.getState();
      expect(state.nestedMode).toBeNull();
      expect(state.isOpen).toBe(true);
    });

    it("should allow switching between nested modes", () => {
      const store = useCommandPaletteStore.getState();

      act(() => {
        store.setNestedMode({ type: "switch-database" });
      });

      expect(useCommandPaletteStore.getState().nestedMode).toEqual({
        type: "switch-database",
      });

      act(() => {
        store.setNestedMode({ type: "switch-schema" });
      });

      expect(useCommandPaletteStore.getState().nestedMode).toEqual({
        type: "switch-schema",
      });
    });
  });
});
