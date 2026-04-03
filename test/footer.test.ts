import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildFooterStatus,
	DEFAULT_FOOTER_CONFIG,
	FOOTER_PRESETS,
	formatFooterConfig,
	formatFooterTemplateVars,
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
			}),
		).toBe("Proj today 12K tok | Total today 82K tok");
	});

	it("supports a global template with formatted values by default", () => {
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
				items: [],
				separator: " || ",
				template: "[project: {projectToday.cost} · {projectToday.tokens} tok]   [total: {totalToday.cost} · {totalToday.tokens} tok]",
			}),
		).toBe("[project: $1.23 · 12K tok]   [total: $3.73 · 82K tok]");
	});

	it("supports raw template variables", () => {
		const now = Date.now();
		const records = [
			record({
				timestamp: now,
				isoTimestamp: new Date(now).toISOString(),
				project: "/tmp/project-a",
				totalTokens: 12345,
				costTotal: 1.23,
			}),
		];

		expect(
			buildFooterStatus(records, "/tmp/project-a", {
				enabled: true,
				items: DEFAULT_FOOTER_CONFIG.items,
				separator: DEFAULT_FOOTER_CONFIG.separator,
				template: "cost={projectToday.costRaw} tokens={projectToday.tokensRaw}",
			}),
		).toBe("cost=1.23 tokens=12345");
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

	it("formats config with template and presets", () => {
		const cwd = "/tmp/project-a";
		const output = formatFooterConfig(
			{
				enabled: true,
				items: ["projectTodaySummary"],
				separator: " | ",
				template: "[project: {projectToday.cost}]",
			},
			cwd,
		);

		expect(output).toContain('Template: "[project: {projectToday.cost}]"');
		expect(output).toContain("Presets: minimal, costs, tokens, summary, full");
	});

	it("lists template variables", () => {
		const output = formatFooterTemplateVars();
		expect(output).toContain("{projectToday.cost}");
		expect(output).toContain("{projectToday.costRaw}");
		expect(output).toContain("{totalToday.summary}");
	});

	it("writes project footer config", () => {
		const cwd = makeTempDir();
		const config = saveProjectFooterConfig(cwd, {
			enabled: false,
			items: ["totalTodaySummary"],
			separator: " | ",
			template: "[total: {totalToday.summary}]",
		});

		expect(config).toEqual({
			enabled: false,
			items: ["totalTodaySummary"],
			separator: " | ",
			template: "[total: {totalToday.summary}]",
		});
		expect(JSON.parse(readFileSync(join(cwd, ".pi-token-usage.json"), "utf-8"))).toEqual(config);
	});

	it("can overwrite config to remove an existing template", () => {
		const cwd = makeTempDir();
		saveProjectFooterConfig(cwd, {
			template: "[project: {projectToday.cost}]",
		});

		const config = writeProjectFooterConfig(cwd, {
			enabled: true,
			items: ["projectTodaySummary", "totalTodaySummary"],
			separator: "  •  ",
			template: undefined,
		});

		expect(config.template).toBeUndefined();
		expect(JSON.parse(readFileSync(join(cwd, ".pi-token-usage.json"), "utf-8"))).toEqual({
			enabled: true,
			items: ["projectTodaySummary", "totalTodaySummary"],
			separator: "  •  ",
		});
	});
});
