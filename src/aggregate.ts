import { Totals, UsageRecord } from "./types";

export function emptyTotals(): Totals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0, count: 0 };
}

export function addToTotals(t: Totals, r: UsageRecord): void {
	t.input += r.input;
	t.output += r.output;
	t.cacheRead += r.cacheRead;
	t.cacheWrite += r.cacheWrite;
	t.totalTokens += r.totalTokens;
	t.costTotal += r.costTotal;
	t.count++;
}

export function aggregateByKey(records: UsageRecord[], keyFn: (r: UsageRecord) => string): Map<string, Totals> {
	const map = new Map<string, Totals>();
	for (const r of records) {
		const key = keyFn(r);
		let t = map.get(key);
		if (!t) {
			t = emptyTotals();
			map.set(key, t);
		}
		addToTotals(t, r);
	}
	return map;
}

export function filterSince(records: UsageRecord[], sinceMs: number): UsageRecord[] {
	return records.filter((r) => r.timestamp >= sinceMs);
}
