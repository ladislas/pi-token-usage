import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildFooterStatus,
	DEFAULT_FOOTER_CONFIG,
	FOOTER_PRESETS,
	formatFooterConfig,
	parseFooterItems,
	parseFooterPreset,
	saveProjectFooterConfig,
	writeProjectFooterConfig,
} from "../src/footer";
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
				labels: {},
			}),
		).toBe("Proj today 12K tok | Total today 82K tok");
	});

	it("supports combined summary items and custom labels", () => {
		const now = Date.now();
		const records = [
			record({
				timestamp: now,
				isoTimestamp: new Date(now).toISOString(),
				project: "/tmp/project-a",
				totalTokens: 12_345,
				costTotal: 1.23,
			}),
			record({
				timestamp: now + 1,
				isoTimestamp: new Date(now + 1).toISOString(),
				project: "/tmp/project-b",
				totalTokens: 70_000,
				costTotal: 2.5,
			}),
		];

		expect(
			buildFooterStatus(records, "/tmp/project-a", {
				enabled: true,
				items: ["projectTodaySummary", "totalTodaySummary"],
				separator: " || ",
				labels: { projectTodaySummary: "Here", totalTodaySummary: "All" },
			}),
		).toBe("Here $1.23 / 12K tok || All $3.73 / 82K tok");
	});

	it("parses footer items and removes duplicates", () => {
		expect(parseFooterItems("projectTodayCost,totalTodayCost projectTodayCost")).toEqual([
			"projectTodayCost",
			"totalTodayCost",
		]);
	});

	it("parses footer presets", () => {
		expect(parseFooterPreset("summary")).toBe("summary");
		expect(FOOTER_PRESETS.full).toEqual([
			"projectTodayTokens",
			"projectTodayCost",
			"totalTodayTokens",
			"totalTodayCost",
		]);
	});

	it("formats config with labels and presets", () => {
		const cwd = "/tmp/project-a";
		const output = formatFooterConfig(
			{
				enabled: true,
				items: ["projectTodaySummary"],
				separator: " | ",
				labels: { projectTodaySummary: "Mine" },
			},
			cwd,
		);

		expect(output).toContain("Custom labels: projectTodaySummary=\"Mine\"");
		expect(output).toContain("Presets: minimal, costs, tokens, summary, full");
	});

	it("writes project footer config", () => {
		const cwd = makeTempDir();
		const config = saveProjectFooterConfig(cwd, {
			enabled: false,
			items: ["totalTodaySummary"],
			separator: " | ",
			labels: { totalTodaySummary: "Everything" },
		});

		expect(config).toEqual({
			enabled: false,
			items: ["totalTodaySummary"],
			separator: " | ",
			labels: { totalTodaySummary: "Everything" },
		});
		expect(JSON.parse(readFileSync(join(cwd, ".pi-token-usage.json"), "utf-8"))).toEqual(config);
	});

	it("can overwrite labels to remove an existing label", () => {
		const cwd = makeTempDir();
		saveProjectFooterConfig(cwd, {
			labels: { projectTodaySummary: "Mine", totalTodaySummary: "Everything" },
		});

		const config = writeProjectFooterConfig(cwd, {
			enabled: true,
			items: ["projectTodaySummary", "totalTodaySummary"],
			separator: "  •  ",
			labels: { totalTodaySummary: "Everything" },
		});

		expect(config.labels).toEqual({ totalTodaySummary: "Everything" });
		expect(JSON.parse(readFileSync(join(cwd, ".pi-token-usage.json"), "utf-8"))).toEqual(config);
	});
});
