import type { Completion } from "@codemirror/autocomplete";

export class CompletionRanker {
  private usageHistory: Map<string, number> = new Map();
  private recentItems: string[] = [];

  rank(completions: Completion[], prefix?: string): Completion[] {
    return completions
      .map((c) => {
        let boost = (c as any).boost ?? 0;
        // usage frequency
        boost += Math.min((this.usageHistory.get(c.label) || 0) * 2, 20);
        // recent items
        const recentIndex = this.recentItems.indexOf(c.label);
        if (recentIndex >= 0) boost += 10 - recentIndex;
        // prefix quality
        const q = this.matchQuality(c.label, prefix);
        boost += q * 10;
        return { ...c, boost };
      })
      .sort((a: any, b: any) => (b.boost ?? 0) - (a.boost ?? 0));
  }

  private matchQuality(label: string, prefix?: string): number {
    if (!prefix) return 0;
    if (label.startsWith(prefix)) return 1;
    const l = label.toLowerCase();
    const p = prefix.toLowerCase();
    if (l.startsWith(p)) return 0.9;
    if (l.includes(p)) return 0.5;
    return 0;
  }

  recordUsage(label: string) {
    this.usageHistory.set(label, (this.usageHistory.get(label) || 0) + 1);
    this.recentItems = this.recentItems.filter((i) => i !== label);
    this.recentItems.unshift(label);
    this.recentItems = this.recentItems.slice(0, 20);
  }
}

export const completionRanker = new CompletionRanker();

export function withUsageApply(apply: string, label: string) {
  return (view: any, _completion: Completion, from: number, to: number) => {
    view.dispatch({ changes: { from, to, insert: apply } });
    completionRanker.recordUsage(label);
  };
}
