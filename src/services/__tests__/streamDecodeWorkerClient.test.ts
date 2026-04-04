import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockWarn, mockError } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
  mockError: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: mockWarn,
    error: mockError,
  },
}));

type WorkerRequest =
  | { id: number; type: "decode"; buffer: ArrayBuffer }
  | { id: number; type: "warmup" };

type WorkerResponse =
  | { id: number; type: "decoded"; rows: unknown[][] }
  | { id: number; type: "warmup" };

class MockWorker {
  static instances: MockWorker[] = [];

  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  messages: WorkerRequest[] = [];
  terminated = false;

  constructor(_url: URL, _options: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  postMessage(message: WorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  static reset(): void {
    MockWorker.instances.length = 0;
  }
}

describe("streamDecodeWorkerClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWorker.reset();
    vi.unstubAllGlobals();
    vi.stubGlobal("Worker", MockWorker);
  });

  afterEach(async () => {
    const { terminateStreamDecodeWorker } = await import("../streamDecodeWorkerClient");
    terminateStreamDecodeWorker();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves worker warmup acknowledgements without rows", async () => {
    const { getStreamDecodeWorker } = await import("../streamDecodeWorkerClient");

    const warmupPromise = getStreamDecodeWorker().warmup();

    const worker = MockWorker.instances[0];
    const request = worker?.messages[0];

    expect(worker).toBeDefined();
    expect(request?.type).toBe("warmup");
    if (!worker || !request) {
      throw new Error("Expected warmup worker request");
    }

    worker.onmessage?.({
      data: {
        id: request.id,
        type: "warmup",
      },
    } as MessageEvent<WorkerResponse>);

    await expect(warmupPromise).resolves.toBeUndefined();
  });

  it("does not time out slow decode responses after five seconds", async () => {
    vi.useFakeTimers();

    const { getStreamDecodeWorker } = await import("../streamDecodeWorkerClient");

    const decodePromise = getStreamDecodeWorker().decode(new ArrayBuffer(8));

    const worker = MockWorker.instances[0];
    const request = worker?.messages[0];

    expect(worker).toBeDefined();
    expect(request?.type).toBe("decode");
    if (!worker || !request) {
      throw new Error("Expected decode worker request");
    }

    await vi.advanceTimersByTimeAsync(6000);

    worker.onmessage?.({
      data: {
        id: request.id,
        type: "decoded",
        rows: [[1]],
      },
    } as MessageEvent<WorkerResponse>);

    await expect(decodePromise).resolves.toEqual([[1]]);
  });
});
