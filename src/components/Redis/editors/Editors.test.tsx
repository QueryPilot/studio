import { render, screen } from "@testing-library/react";
import { ZSetEditor } from "./ZSetEditor";
import { StreamViewer } from "./StreamViewer";
import React from "react";
import { describe, it, expect, vi } from "vitest";

describe("Redis Editors", () => {
  describe("ZSetEditor", () => {
    it("renders members and scores", () => {
      const props = {
        value: [
          { member: "m1", score: 10 },
          { member: "m2", score: 20 },
        ],
        onUpdate: vi.fn(),
        connectionId: "test",
        keyName: "test:zset",
      };
      render(<ZSetEditor {...props} />);
      expect(screen.getByText("m1")).toBeInTheDocument();
      expect(screen.getByText("10")).toBeInTheDocument();
    });
  });

  describe("StreamViewer", () => {
    it("renders stream entries", () => {
      const props = {
        value: [
          { id: "1000-0", fields: { name: "test", value: "123" } },
        ],
        onUpdate: vi.fn(),
        connectionId: "test",
        keyName: "test:stream",
      };
      render(<StreamViewer {...props} />);
      expect(screen.getByText("1000-0")).toBeInTheDocument();
      expect(screen.getByText("name:")).toBeInTheDocument();
      expect(screen.getByText("123")).toBeInTheDocument();
    });
  });
});
