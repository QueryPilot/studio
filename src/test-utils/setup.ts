/**
 * Vitest setup file
 * Runs before all tests
 */

import { expect, afterEach, vi, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import { randomFillSync } from 'crypto';
import 'fake-indexeddb/auto';

// Setup crypto for Tauri IPC (required for mockIPC to work)
beforeAll(() => {
  let uuidCounter = 0;
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (buffer: any) => randomFillSync(buffer),
      randomUUID: () => {
        uuidCounter++;
        return `test-uuid-${uuidCounter}`;
      },
    },
  });
});

// Cleanup after each test
afterEach(() => {
  cleanup();
  clearMocks(); // Clear Tauri mocks
  vi.clearAllMocks();
});

// Add custom matchers if needed
expect.extend({
  // Custom matchers can be added here
});

// Mock window.matchMedia (required for many UI components)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver (required for virtualized lists)
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;

// Mock ResizeObserver (required for responsive components)
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;
