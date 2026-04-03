import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageRecord } from "../src/types";
import { costColumnStart, msgsColumnStart } from "./helpers";

const scanAllSessions = vi.fn<() => UsageRecord[]>();
const refreshCachedRecords = vi.fn();

vi.mock("../src/scan", () => ({
	scanAllSessions,
	refreshCachedRecords,
}));

const { cmdUsageSummary, cmdUsageProjects, cmdUsageSessions, refreshUsageData } = await import("../src/commands");
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

describe("additional usage command rendering", () => {
	beforeEach(() => {
		scanAllSessions.mockReset();
		refreshCachedRecords.mockReset();
	});

	it("keeps summary today model rows aligned for long model names", () => {
		const today = new Date();
		today.setHours(12, 0, 0, 0);
		scanAllSessions.mockReturnValue([
			record({
				timestamp: today.getTime(),
				isoTimestamp: today.toISOString(),
				provider: "anthropic",
				model: "claude-haiku-4-5-20251001",
				input: 120_000,
				output: 30_000,
				cacheRead: 4_500_000,
				cacheWrite: 12_000,
				totalTokens: 4_662_000,
				costTotal: 2.31,
			}),
			record({
				timestamp: today.getTime() + 1000,
				isoTimestamp: new Date(today.getTime() + 1000).toISOString(),
				provider: "openai-codex",
				model: "gpt-5.4",
				project: "/Users/test/another-project",
				sessionId: "session-2",
				input: 50_000,
				output: 10_000,
				cacheRead: 100_000,
				cacheWrite: 0,
				totalTokens: 160_000,
				costTotal: 1.2,
			}),
		]);

		const output = cmdUsageSummary();
		const lines = stripAnsi(output).split("\n");
		const todayLine = lines.find((line) => line.trimStart().startsWith("Today"));
		const longModelLine = lines.find((line) => line.includes("anthropic/claude-haiku-4-5-20251001"));
		const shortModelLine = lines.find((line) => line.includes("openai-codex/gpt-5.4"));

		expect(todayLine).toBeTruthy();
		expect(longModelLine).toBeTruthy();
		expect(shortModelLine).toBeTruthy();
		expect(costColumnStart(longModelLine!)).toBe(costColumnStart(todayLine!));
		expect(costColumnStart(shortModelLine!)).toBe(costColumnStart(todayLine!));
	});

	it("keeps project table aligned for long project names", () => {
		scanAllSessions.mockReturnValue([
			record({
				timestamp: Date.now(),
				isoTimestamp: new Date().toISOString(),
				project: "/Users/ladislas/dev/client/very-long-monorepo-package-name-alpha",
				input: 100_000,
				output: 12_000,
				totalTokens: 112_000,
				costTotal: 1.23,
			}),
			record({
				timestamp: Date.now() + 1,
				isoTimestamp: new Date(Date.now() + 1).toISOString(),
				project: "/Users/ladislas/dev/x/y",
				sessionId: "session-2",
				input: 90_000,
				output: 10_000,
				totalTokens: 100_000,
				costTotal: 0.8,
			}),
		]);

		const output = cmdUsageProjects();
		const lines = stripAnsi(output).split("\n");
		const longProjectLine = lines.find((line) => line.includes("client/very-long-monorepo-package-name-alpha"));
		const shortProjectLine = lines.find((line) => line.includes("x/y"));

		expect(longProjectLine).toBeTruthy();
		expect(shortProjectLine).toBeTruthy();
		expect(costColumnStart(longProjectLine!)).toBe(costColumnStart(shortProjectLine!));
		expect(msgsColumnStart(longProjectLine!)).toBe(msgsColumnStart(shortProjectLine!));
	});

	it("keeps sessions table aligned for long session ids and project names", () => {
		scanAllSessions.mockReturnValue([
			record({
				timestamp: Date.now(),
				isoTimestamp: new Date().toISOString(),
				sessionId: "session-with-a-very-long-identifier-0000001",
				project: "/Users/ladislas/dev/acme/super-long-project-name",
				input: 100_000,
				output: 20_000,
				totalTokens: 120_000,
				costTotal: 4.56,
			}),
			record({
				timestamp: Date.now() + 1,
				isoTimestamp: new Date(Date.now() + 1).toISOString(),
				sessionId: "s2",
				project: "/Users/ladislas/dev/bb/cc",
				input: 90_000,
				output: 10_000,
				totalTokens: 100_000,
				costTotal: 1.1,
			}),
		]);

		const output = cmdUsageSessions(10);
		const lines = stripAnsi(output).split("\n");
		const longLine = lines.find((line) => line.includes("session-with-a-very-long-identifier-0000001"));
		const shortLine = lines.find((line) => line.includes("s2"));

		expect(longLine).toBeTruthy();
		expect(shortLine).toBeTruthy();
		expect(costColumnStart(longLine!)).toBe(costColumnStart(shortLine!));
		expect(msgsColumnStart(longLine!)).toBe(msgsColumnStart(shortLine!));
	});

	it("refreshUsageData clears cache and returns a fresh summary", () => {
		scanAllSessions.mockReturnValue([]);
		const output = refreshUsageData();
		expect(refreshCachedRecords).toHaveBeenCalledTimes(1);
		expect(output).toContain("No usage data found");
	});
});
