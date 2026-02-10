import { logger } from "@/lib/logger";

interface TimingAggregate {
  count: number;
  totalMs: number;
  maxMs: number;
}

interface CommandStats {
  count: number;
  failures: number;
  totalMs: number;
  maxMs: number;
}

export interface KeyboardTelemetrySnapshot {
  keydownCount: number;
  keyupCount: number;
  commandsExecuted: number;
  commandFailures: number;
  matchedDispatches: number;
  unmatchedDispatches: number;
  chordStarts: number;
  chordCompletes: number;
  chordCancels: number;
  preventedDefaultCount: number;
  resolveTiming: TimingAggregate;
  executeTiming: TimingAggregate;
  commandStats: Record<string, CommandStats>;
}

class KeyboardTelemetryService {
  private keydownCount = 0;
  private keyupCount = 0;
  private commandsExecuted = 0;
  private commandFailures = 0;
  private matchedDispatches = 0;
  private unmatchedDispatches = 0;
  private chordStarts = 0;
  private chordCompletes = 0;
  private chordCancels = 0;
  private preventedDefaultCount = 0;
  private resolveTiming: TimingAggregate = { count: 0, totalMs: 0, maxMs: 0 };
  private executeTiming: TimingAggregate = { count: 0, totalMs: 0, maxMs: 0 };
  private commandStats = new Map<string, CommandStats>();

  recordKeyEvent(type: "keydown" | "keyup"): void {
    if (type === "keydown") {
      this.keydownCount += 1;
      return;
    }
    this.keyupCount += 1;
  }

  recordResolve(durationMs: number, matched: boolean): void {
    this.resolveTiming.count += 1;
    this.resolveTiming.totalMs += durationMs;
    this.resolveTiming.maxMs = Math.max(this.resolveTiming.maxMs, durationMs);
    if (matched) {
      this.matchedDispatches += 1;
    } else {
      this.unmatchedDispatches += 1;
    }
  }

  recordChordStart(): void {
    this.chordStarts += 1;
  }

  recordChordComplete(): void {
    this.chordCompletes += 1;
  }

  recordChordCancel(): void {
    this.chordCancels += 1;
  }

  recordPreventDefault(): void {
    this.preventedDefaultCount += 1;
  }

  recordCommand(commandId: string, durationMs: number, success: boolean): void {
    this.executeTiming.count += 1;
    this.executeTiming.totalMs += durationMs;
    this.executeTiming.maxMs = Math.max(this.executeTiming.maxMs, durationMs);
    this.commandsExecuted += 1;
    if (!success) {
      this.commandFailures += 1;
    }

    const existing = this.commandStats.get(commandId) ?? {
      count: 0,
      failures: 0,
      totalMs: 0,
      maxMs: 0,
    };
    existing.count += 1;
    existing.totalMs += durationMs;
    existing.maxMs = Math.max(existing.maxMs, durationMs);
    if (!success) {
      existing.failures += 1;
    }
    this.commandStats.set(commandId, existing);
  }

  snapshot(): KeyboardTelemetrySnapshot {
    const commands: Record<string, CommandStats> = {};
    for (const [commandId, stats] of this.commandStats.entries()) {
      commands[commandId] = { ...stats };
    }

    return {
      keydownCount: this.keydownCount,
      keyupCount: this.keyupCount,
      commandsExecuted: this.commandsExecuted,
      commandFailures: this.commandFailures,
      matchedDispatches: this.matchedDispatches,
      unmatchedDispatches: this.unmatchedDispatches,
      chordStarts: this.chordStarts,
      chordCompletes: this.chordCompletes,
      chordCancels: this.chordCancels,
      preventedDefaultCount: this.preventedDefaultCount,
      resolveTiming: { ...this.resolveTiming },
      executeTiming: { ...this.executeTiming },
      commandStats: commands,
    };
  }

  reset(): void {
    this.keydownCount = 0;
    this.keyupCount = 0;
    this.commandsExecuted = 0;
    this.commandFailures = 0;
    this.matchedDispatches = 0;
    this.unmatchedDispatches = 0;
    this.chordStarts = 0;
    this.chordCompletes = 0;
    this.chordCancels = 0;
    this.preventedDefaultCount = 0;
    this.resolveTiming = { count: 0, totalMs: 0, maxMs: 0 };
    this.executeTiming = { count: 0, totalMs: 0, maxMs: 0 };
    this.commandStats.clear();
  }

  logSnapshot(prefix = "[keyboardTelemetry]"): void {
    logger.info(prefix, this.snapshot());
  }
}

export const keyboardTelemetry = new KeyboardTelemetryService();
