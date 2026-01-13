import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { KeyBrowser } from "@/components/Redis/KeyBrowser";

// Mock child components to avoid complex rendering
vi.mock("./editors/StringEditor", () => ({ StringEditor: () => <div>StringEditor</div> }));
vi.mock("./editors/HashEditor", () => ({ HashEditor: () => <div>HashEditor</div> }));
vi.mock("./editors/ListEditor", () => ({ ListEditor: () => <div>ListEditor</div> }));
vi.mock("./editors/SetEditor", () => ({ SetEditor: () => <div>SetEditor</div> }));

// Mock stores
const mockFetchNextPage = vi.fn();
const mockSetScanPattern = vi.fn();
const mockResetScan = vi.fn();
const mockSetConnectionId = vi.fn();

vi.mock("@/stores/redisStore", () => ({
  useRedisStore: vi.fn(() => ({
    scannedKeys: [],
    scanLoading: false,
    scanComplete: false,
    scanCursor: 0,
    scanPattern: "*",
    fetchNextPage: mockFetchNextPage,
    setScanPattern: mockSetScanPattern,
    resetScan: mockResetScan,
    setConnectionId: mockSetConnectionId,
  })),
}));

vi.mock("@/stores/panelStore", () => ({
  usePanelStore: vi.fn(() => ({
    addTabToPanel: vi.fn(),
    activePanelId: "test-panel",
  })),
}));

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("KeyBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders key grid columns when no key is selected", () => {
    render(<KeyBrowser connectionId="test-conn" database={0} />);
    
    // Should show grid headers
    expect(screen.getByText("Key")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.getByText("TTL")).toBeInTheDocument();
  });

  it("renders empty state when no keys found", () => {
    render(<KeyBrowser connectionId="test-conn" database={0} />);
    expect(screen.getByText(/No keys found/i)).toBeInTheDocument();
  });

  it("fetches keys on mount if empty", () => {
    render(<KeyBrowser connectionId="test-conn" database={0} />);
    expect(mockFetchNextPage).toHaveBeenCalled();
  });
});
