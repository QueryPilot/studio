import { describe, it, expect } from "vitest";
import {
  CONNECTION_COLORS,
  CONNECTION_BORDER_COLORS,
  CONNECTION_RING_COLORS,
  getConnectionColorIndex,
  getConnectionColor,
  getConnectionBorderColor,
  getConnectionRingColor,
  shouldShowConnectionColors,
} from "./connectionColors";

describe("connectionColors", () => {
  describe("constants", () => {
    it("has 5 background colors", () => {
      expect(CONNECTION_COLORS).toHaveLength(5);
    });

    it("has matching border colors", () => {
      expect(CONNECTION_BORDER_COLORS).toHaveLength(CONNECTION_COLORS.length);
    });

    it("has matching ring colors", () => {
      expect(CONNECTION_RING_COLORS).toHaveLength(CONNECTION_COLORS.length);
    });

    it("colors are consistent across variants", () => {
      // Check that the color names match across bg, border, and ring variants
      expect(CONNECTION_COLORS[0]).toBe("bg-green-500");
      expect(CONNECTION_BORDER_COLORS[0]).toBe("border-green-500");
      expect(CONNECTION_RING_COLORS[0]).toBe("ring-green-500");
    });
  });

  describe("getConnectionColorIndex", () => {
    it("returns 0 for the first connection", () => {
      const connectionIds = ["conn-1", "conn-2", "conn-3"];
      expect(getConnectionColorIndex("conn-1", connectionIds)).toBe(0);
    });

    it("returns 1 for the second connection", () => {
      const connectionIds = ["conn-1", "conn-2", "conn-3"];
      expect(getConnectionColorIndex("conn-2", connectionIds)).toBe(1);
    });

    it("returns correct index for connections up to 5", () => {
      const connectionIds = ["a", "b", "c", "d", "e"];
      expect(getConnectionColorIndex("a", connectionIds)).toBe(0);
      expect(getConnectionColorIndex("b", connectionIds)).toBe(1);
      expect(getConnectionColorIndex("c", connectionIds)).toBe(2);
      expect(getConnectionColorIndex("d", connectionIds)).toBe(3);
      expect(getConnectionColorIndex("e", connectionIds)).toBe(4);
    });

    it("cycles colors when more than 5 connections", () => {
      const connectionIds = ["a", "b", "c", "d", "e", "f", "g"];
      // 6th connection (index 5) should cycle back to 0
      expect(getConnectionColorIndex("f", connectionIds)).toBe(0);
      // 7th connection (index 6) should cycle to 1
      expect(getConnectionColorIndex("g", connectionIds)).toBe(1);
    });

    it("returns 0 when connection not found", () => {
      const connectionIds = ["conn-1", "conn-2"];
      expect(getConnectionColorIndex("unknown", connectionIds)).toBe(0);
    });

    it("returns 0 for empty connection list", () => {
      expect(getConnectionColorIndex("conn-1", [])).toBe(0);
    });
  });

  describe("getConnectionColor", () => {
    it("returns correct background color for first connection", () => {
      const connectionIds = ["conn-1", "conn-2"];
      expect(getConnectionColor("conn-1", connectionIds)).toBe("bg-green-500");
    });

    it("returns correct background color for second connection", () => {
      const connectionIds = ["conn-1", "conn-2"];
      expect(getConnectionColor("conn-2", connectionIds)).toBe("bg-blue-500");
    });

    it("returns first color for unknown connection", () => {
      expect(getConnectionColor("unknown", ["a", "b"])).toBe("bg-green-500");
    });
  });

  describe("getConnectionBorderColor", () => {
    it("returns correct border color for first connection", () => {
      const connectionIds = ["conn-1", "conn-2"];
      expect(getConnectionBorderColor("conn-1", connectionIds)).toBe(
        "border-green-500",
      );
    });

    it("returns correct border color for second connection", () => {
      const connectionIds = ["conn-1", "conn-2"];
      expect(getConnectionBorderColor("conn-2", connectionIds)).toBe(
        "border-blue-500",
      );
    });

    it("returns first color for unknown connection", () => {
      expect(getConnectionBorderColor("unknown", ["a", "b"])).toBe(
        "border-green-500",
      );
    });
  });

  describe("getConnectionRingColor", () => {
    it("returns correct ring color for first connection", () => {
      const connectionIds = ["conn-1", "conn-2"];
      expect(getConnectionRingColor("conn-1", connectionIds)).toBe(
        "ring-green-500",
      );
    });

    it("returns correct ring color for second connection", () => {
      const connectionIds = ["conn-1", "conn-2"];
      expect(getConnectionRingColor("conn-2", connectionIds)).toBe(
        "ring-blue-500",
      );
    });

    it("returns first color for unknown connection", () => {
      expect(getConnectionRingColor("unknown", ["a", "b"])).toBe(
        "ring-green-500",
      );
    });
  });

  describe("shouldShowConnectionColors", () => {
    it("returns false for 0 connections", () => {
      expect(shouldShowConnectionColors(0)).toBe(false);
    });

    it("returns false for 1 connection", () => {
      expect(shouldShowConnectionColors(1)).toBe(false);
    });

    it("returns true for 2 connections", () => {
      expect(shouldShowConnectionColors(2)).toBe(true);
    });

    it("returns true for more than 2 connections", () => {
      expect(shouldShowConnectionColors(3)).toBe(true);
      expect(shouldShowConnectionColors(5)).toBe(true);
      expect(shouldShowConnectionColors(10)).toBe(true);
    });
  });
});
