import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildFooterStatus, DEFAULT_FOOTER_CONFIG, parseFooterItems, saveProjectFooterConfig } from "../src/footer";
import type { UsageRecord } from "../src/types";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-token-usage-"));
	tempDirs.push(dir);
	return dir;
}

function record(partial: Partial<UsageRecord> & Pick<UsageRecord, "timestamp" | "isoTimestamp">): UsageRecord {
	return {
		provider: "openai-codex",
		model: "gpt-5.4",
		project: "/tmp/project-a",
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

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
	}
});

describe("footer helpers", () => {
	it("builds the default footer status for project and total today cost", () => {
		const now = Date.now();
		const records = [
			record({
				timestamp: now,
				isoTimestamp: new Date(now).toISOString(),
				project: "/tmp/project-a",
				costTotal: 1.23,
			}),
			record({
				timestamp: now + 1,
				isoTimestamp: new Date(now + 1).toISOString(),
				project: "/tmp/project-b",
				costTotal: 2.5,
			}),
		];

		expect(buildFooterStatus(records, "/tmp/project-a", DEFAULT_FOOTER_CONFIG)).toBe(
			"Proj today $1.23  •  Total today $3.73",
		);
	});

	it("supports token-based footer items", () => {
		const now = Date.now();
		const records = [
			record({
				timestamp: now,
				isoTimestamp: new Date(now).toISOString(),
				project: "/tmp/project-a",
				totalTokens: 12_345,
			}),
			record({
				timestamp: now + 1,
				isoTimestamp: new Date(now + 1).toISOString(),
				project: "/tmp/project-b",
				totalTokens: 70_000,
			}),
		];

		expect(
			buildFooterStatus(records, "/tmp/project-a", {
				enabled: true,
				items: ["projectTodayTokens", "totalTodayTokens"],
				separator: " | ",
			}),
		).toBe("Proj today 12K tok | Total today 82K tok");
	});

	it("parses footer items and removes duplicates", () => {
		expect(parseFooterItems("projectTodayCost,totalTodayCost projectTodayCost")).toEqual([
			"projectTodayCost",
			"totalTodayCost",
		]);
	});

	it("writes project footer config", () => {
		const cwd = makeTempDir();
		const config = saveProjectFooterConfig(cwd, { enabled: false, items: ["totalTodayTokens"], separator: " | " });

		expect(config).toEqual({ enabled: false, items: ["totalTodayTokens"], separator: " | " });
		expect(JSON.parse(readFileSync(join(cwd, ".pi-token-usage.json"), "utf-8"))).toEqual(config);
	});
});
