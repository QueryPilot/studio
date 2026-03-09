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

type RandomValuesBuffer = Parameters<Crypto['getRandomValues']>[0];

const createEmptyDomRectList = (): DOMRectList =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: (): ArrayIterator<DOMRect> => [][Symbol.iterator](),
  }) as unknown as DOMRectList;

const createZeroDomRect = (): DOMRect =>
  ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
  }) as DOMRect;

// Setup crypto for Tauri IPC (required for mockIPC to work)
beforeAll(() => {
  let uuidCounter = 0;
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: <T extends RandomValuesBuffer>(buffer: T): T => {
        randomFillSync(buffer as unknown as NodeJS.ArrayBufferView);
        return buffer;
      },
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
class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [];

  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
}
global.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;

// Mock ResizeObserver (required for responsive components)
class MockResizeObserver implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}
global.ResizeObserver =
  MockResizeObserver as unknown as typeof ResizeObserver;

// Mock Clipboard API (required for copy/paste functionality)
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
  writable: true,
  configurable: true,
});

// Mock Path2D (required for canvas rendering in DataGrid)
const MockPath2D = function MockPath2D() {};
global.Path2D = MockPath2D as unknown as typeof Path2D;

Object.defineProperty(Range.prototype, 'getClientRects', {
  configurable: true,
  value: () => createEmptyDomRectList(),
});

Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => createZeroDomRect(),
});
