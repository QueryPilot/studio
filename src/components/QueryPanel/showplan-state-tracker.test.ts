import { describe, it, expect } from "vitest";
import {
  createShowplanTracker,
  parseShowplanSet,
} from "./showplan-state-tracker";

describe("parseShowplanSet", () => {
  it("detects SET SHOWPLAN_ALL ON", () => {
    expect(parseShowplanSet("SET SHOWPLAN_ALL ON")).toEqual({
      format: "all",
      enabled: true,
    });
  });

  it("detects SET SHOWPLAN_ALL OFF", () => {
    expect(parseShowplanSet("SET SHOWPLAN_ALL OFF")).toEqual({
      format: "all",
      enabled: false,
    });
  });

  it("detects SET SHOWPLAN_XML ON", () => {
    expect(parseShowplanSet("SET SHOWPLAN_XML ON")).toEqual({
      format: "xml",
      enabled: true,
    });
  });

  it("detects SET SHOWPLAN_TEXT ON", () => {
    expect(parseShowplanSet("SET SHOWPLAN_TEXT ON")).toEqual({
      format: "text",
      enabled: true,
    });
  });

  it("detects SET STATISTICS PROFILE ON", () => {
    expect(parseShowplanSet("SET STATISTICS PROFILE ON")).toEqual({
      format: "statistics_profile",
      enabled: true,
    });
  });

  it("is case insensitive", () => {
    expect(parseShowplanSet("set showplan_all on")).toEqual({
      format: "all",
      enabled: true,
    });
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseShowplanSet("  SET SHOWPLAN_ALL ON  ")).toEqual({
      format: "all",
      enabled: true,
    });
  });

  it("detects SET STATISTICS XML ON", () => {
    expect(parseShowplanSet("SET STATISTICS XML ON")).toEqual({
      format: "statistics_xml",
      enabled: true,
    });
  });

  it("returns null for non-SHOWPLAN statements", () => {
    expect(parseShowplanSet("SELECT * FROM users")).toBeNull();
    expect(parseShowplanSet("SET NOCOUNT ON")).toBeNull();
    expect(parseShowplanSet("SET STATISTICS TIME ON")).toBeNull();
    expect(parseShowplanSet("SET STATISTICS IO ON")).toBeNull();
  });
});

describe("createShowplanTracker", () => {
  it("starts with no active state", () => {
    const tracker = createShowplanTracker();
    expect(tracker.getState()).toBeNull();
  });

  it("tracks ON/OFF toggle", () => {
    const tracker = createShowplanTracker();
    tracker.processStatement("SET SHOWPLAN_ALL ON");
    expect(tracker.getState()).toBe("all");
    tracker.processStatement("SET SHOWPLAN_ALL OFF");
    expect(tracker.getState()).toBeNull();
  });

  it("wraps queries when SHOWPLAN is active", () => {
    const tracker = createShowplanTracker();
    tracker.processStatement("SET SHOWPLAN_ALL ON");
    const result = tracker.processStatement("SELECT * FROM users");
    expect(result).toEqual({
      isShowplanSet: false,
      isShowplan: true,
      showplanFormat: "all",
      wrappedSql: "SET SHOWPLAN_ALL ON;\nSELECT * FROM users;\nSET SHOWPLAN_ALL OFF;",
      label: null,
    });
  });

  it("does not wrap when SHOWPLAN is inactive", () => {
    const tracker = createShowplanTracker();
    const result = tracker.processStatement("SELECT * FROM users");
    expect(result).toEqual({
      isShowplanSet: false,
      isShowplan: false,
      showplanFormat: null,
      wrappedSql: null,
      label: null,
    });
  });

  it("returns label for SET statements", () => {
    const tracker = createShowplanTracker();
    const result = tracker.processStatement("SET SHOWPLAN_ALL ON");
    expect(result).toEqual({
      isShowplanSet: true,
      isShowplan: false,
      showplanFormat: null,
      wrappedSql: null,
      label: "SHOWPLAN_ALL ON",
    });
  });

  it("handles interleaved ON/OFF across formats", () => {
    const tracker = createShowplanTracker();
    tracker.processStatement("SET SHOWPLAN_ALL ON");
    expect(tracker.getState()).toBe("all");

    tracker.processStatement("SELECT 1");

    tracker.processStatement("SET SHOWPLAN_ALL OFF");
    expect(tracker.getState()).toBeNull();

    tracker.processStatement("SELECT 2");

    tracker.processStatement("SET SHOWPLAN_XML ON");
    expect(tracker.getState()).toBe("xml");

    const result = tracker.processStatement("SELECT 3");
    expect(result.wrappedSql).toContain("SET SHOWPLAN_XML ON");
  });

  it("OFF for never-enabled format is a no-op", () => {
    const tracker = createShowplanTracker();
    const result = tracker.processStatement("SET SHOWPLAN_XML OFF");
    expect(result.isShowplanSet).toBe(true);
    expect(result.label).toBe("SHOWPLAN_XML OFF");
    expect(tracker.getState()).toBeNull();
  });

  it("switching format replaces previous", () => {
    const tracker = createShowplanTracker();
    tracker.processStatement("SET SHOWPLAN_ALL ON");
    tracker.processStatement("SET SHOWPLAN_XML ON");
    expect(tracker.getState()).toBe("xml");
    const result = tracker.processStatement("SELECT 1");
    expect(result.wrappedSql).toContain("SET SHOWPLAN_XML ON");
  });

  it("reset clears all state", () => {
    const tracker = createShowplanTracker();
    tracker.processStatement("SET SHOWPLAN_ALL ON");
    tracker.reset();
    expect(tracker.getState()).toBeNull();
  });
});
