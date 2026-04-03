import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageRecord } from "../src/types";

const scanAllSessions = vi.fn<() => UsageRecord[]>();
const refreshCachedRecords = vi.fn();

vi.mock("../src/scan", () => ({
	scanAllSessions,
	refreshCachedRecords,
}));

const { cmdUsageDays, cmdUsageMonths } = await import("../src/commands");
const { stripAnsi } = await import("../src/format");

function record(partial: Partial<UsageRecord> & Pick<UsageRecord, "timestamp" | "isoTimestamp">): UsageRecord {
	return {
		provider: "openai-codex",
		model: "gpt-5.4",
		project: "/Users/test/project",
		sessionId: "session-1",
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		costTotal: 0,
		...partial,
	};
}

function costColumnStart(line: string): number {
	const plain = stripAnsi(line);
	const match = plain.match(/\$\d/);
	if (!match || match.index == null) throw new Error(`No cost column in line: ${plain}`);
	return match.index;
}

describe("usage command rendering", () => {
	beforeEach(() => {
		scanAllSessions.mockReset();
		refreshCachedRecords.mockReset();
	});

	it("keeps daily rows vertically aligned for very long model names", () => {
		scanAllSessions.mockReturnValue([
			record({
				timestamp: new Date("2026-04-02T10:00:00.000Z").getTime(),
				isoTimestamp: "2026-04-02T10:00:00.000Z",
				provider: "openai-codex",
				model: "gpt-5.4",
				input: 4_800_000,
				output: 236_000,
				cacheRead: 36_400_000,
				cacheWrite: 0,
				totalTokens: 41_436_000,
				costTotal: 24.6,
			}),
			record({
				timestamp: new Date("2026-04-02T11:00:00.000Z").getTime(),
				isoTimestamp: "2026-04-02T11:00:00.000Z",
				provider: "anthropic",
				model: "claude-haiku-4-5-20251001",
				input: 26,
				output: 14_000,
				cacheRead: 2_300_000,
				cacheWrite: 259_000,
				totalTokens: 2_573_026,
				costTotal: 3.13,
			}),
		]);

		const output = cmdUsageDays(7);
		const lines = stripAnsi(output).split("\n");
		const dayLine = lines.find((line) => line.includes("2026-04-02"));
		const shortModelLine = lines.find((line) => line.includes("openai-codex/gpt-5.4"));
		const longModelLine = lines.find((line) => line.includes("anthropic/claude-haiku-4-5-20251001"));

		expect(dayLine).toBeTruthy();
		expect(shortModelLine).toBeTruthy();
		expect(longModelLine).toBeTruthy();
		expect(costColumnStart(shortModelLine!)).toBe(costColumnStart(dayLine!));
		expect(costColumnStart(longModelLine!)).toBe(costColumnStart(dayLine!));
	});

	it("keeps monthly rows vertically aligned for very long model names", () => {
		scanAllSessions.mockReturnValue([
			record({
				timestamp: new Date("2026-04-02T10:00:00.000Z").getTime(),
				isoTimestamp: "2026-04-02T10:00:00.000Z",
				provider: "anthropic",
				model: "claude-haiku-4-5-20251001",
				input: 123_000,
				output: 45_000,
				cacheRead: 3_000_000,
				cacheWrite: 10_000,
				totalTokens: 3_178_000,
				costTotal: 2.45,
			}),
			record({
				timestamp: new Date("2026-03-03T10:00:00.000Z").getTime(),
				isoTimestamp: "2026-03-03T10:00:00.000Z",
				provider: "openai-codex",
				model: "gpt-5.4",
				input: 456_000,
				output: 12_000,
				cacheRead: 1_000_000,
				cacheWrite: 0,
				totalTokens: 1_468_000,
				costTotal: 6.78,
			}),
		]);

		const output = cmdUsageMonths();
		const lines = stripAnsi(output).split("\n");
		const monthLine = lines.find((line) => line.includes("2026-04"));
		const longModelLine = lines.find((line) => line.includes("anthropic/claude-haiku-4-5-20251001"));

		expect(monthLine).toBeTruthy();
		expect(longModelLine).toBeTruthy();
		expect(costColumnStart(longModelLine!)).toBe(costColumnStart(monthLine!));
	});
});
