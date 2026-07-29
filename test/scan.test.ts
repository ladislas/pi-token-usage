import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, userInfo } from "node:os";
import { refreshCachedRecords, scanAllSessions } from "../src/scan";

function writeJsonlFile(dir: string, filename: string, lines: Array<Record<string, unknown> | string>) {
	mkdirSync(dir, { recursive: true });
	const content = lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n");
	writeFileSync(join(dir, filename), `${content}\n`, "utf-8");
}

function writeSessionFile(baseDir: string, projectDir: string, filename: string, lines: Array<Record<string, unknown> | string>) {
	writeJsonlFile(join(baseDir, "sessions", projectDir), filename, lines);
}

function writeSubagentSessionFile(runsDir: string, scopeDir: string, filename: string, lines: Array<Record<string, unknown> | string>) {
	writeJsonlFile(join(runsDir, scopeDir), filename, lines);
}

function assistantUsage(timestamp: string, input: number, output: number) {
	return {
		type: "message",
		timestamp,
		message: {
			role: "assistant",
			provider: "openai-codex",
			model: "gpt-5.6-luna",
			usage: { input, output, cost: { total: 0 } },
		},
	};
}

describe("scanAllSessions", () => {
	let tempDir: string;
	let originalAgentDir: string | undefined;
	let originalTmpDir: string | undefined;

	beforeEach(() => {
		originalAgentDir = process.env.PI_CODING_AGENT_DIR;
		originalTmpDir = process.env.TMPDIR;
		tempDir = mkdtempSync(join(tmpdir(), "pi-token-usage-"));
		process.env.PI_CODING_AGENT_DIR = tempDir;
		process.env.TMPDIR = join(tempDir, "os-tmp");
		mkdirSync(process.env.TMPDIR, { recursive: true });
		refreshCachedRecords();
	});

	afterEach(() => {
		refreshCachedRecords();
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		if (originalTmpDir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = originalTmpDir;
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("parses assistant usage records, uses session cwd, deduplicates, and sorts chronologically", () => {
		writeSessionFile(tempDir, "fallback-project", "2026-04-02T13-55-08-857Z_session-a.jsonl", [
			{ type: "session", cwd: "/Users/test/real-project" },
			{ type: "message", timestamp: "2026-04-02T10:00:00.000Z", message: { role: "user", content: "hi" } },
			{
				type: "message",
				timestamp: "2026-04-02T10:01:00.000Z",
				message: {
					role: "assistant",
					provider: "anthropic",
					model: "claude-haiku-4-5-20251001",
					timestamp: new Date("2026-04-02T10:01:00.000Z").getTime(),
					usage: {
						input: 100,
						output: 50,
						cacheRead: 25,
						cacheWrite: 10,
						totalTokens: 185,
						cost: { total: 0.42 },
					},
				},
			},
		]);

		writeSessionFile(tempDir, "fallback-project-2", "2026-04-02T13-56-08-857Z_session-b.jsonl", [
			"not json",
			{
				type: "message",
				timestamp: "2026-04-02T09:59:00.000Z",
				message: {
					role: "assistant",
					provider: "openai-codex",
					model: "gpt-5.4",
					usage: {
						input: 10,
						output: 20,
						cacheRead: 0,
						cacheWrite: 0,
						cost: { total: 0.05 },
					},
				},
			},
			{
				type: "message",
				timestamp: "2026-04-02T10:01:00.000Z",
				message: {
					role: "assistant",
					provider: "anthropic",
					model: "claude-haiku-4-5-20251001",
					usage: {
						input: 100,
						output: 50,
						cacheRead: 25,
						cacheWrite: 10,
						totalTokens: 185,
						cost: { total: 0.42 },
					},
				},
			},
		]);

		const records = scanAllSessions();
		expect(records).toHaveLength(2);
		expect(records.map((r) => r.timestamp)).toEqual([
			new Date("2026-04-02T09:59:00.000Z").getTime(),
			new Date("2026-04-02T10:01:00.000Z").getTime(),
		]);
		expect(records[1].project).toBe("/Users/test/real-project");
		expect(records[1].sessionId).toBe("session-a");
		expect(records[0].totalTokens).toBe(30);
	});

	it("scans configured persistent pi-codex-subagents runs", () => {
		const packageDir = join(tempDir, "pi-codex-subagents");
		const runsDir = join(packageDir, "runs");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(packageDir, "config.json"), JSON.stringify({ storageDir: "runs" }), "utf-8");
		writeSubagentSessionFile(runsDir, "parent-scope", "child-session.jsonl", [
			{ type: "session", cwd: "/Users/test/subagent-project" },
			assistantUsage("2026-04-02T10:03:00.000Z", 40, 12),
		]);

		const records = scanAllSessions();
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			project: "/Users/test/subagent-project",
			sessionId: "child-session",
			provider: "openai-codex",
			model: "gpt-5.6-luna",
			input: 40,
			output: 12,
			totalTokens: 52,
		});
	});

	it("scans legacy pi-codex-subagents runs from the OS temporary directory", () => {
		const runsDir = join(process.env.TMPDIR!, "pi-codex-subagents", userInfo().username, "runs");
		writeSubagentSessionFile(runsDir, "parent-scope", "temporary-child.jsonl", [
			{ type: "session", cwd: "/Users/test/temporary-project" },
			assistantUsage("2026-04-02T10:04:00.000Z", 20, 8),
		]);

		const records = scanAllSessions();
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			project: "/Users/test/temporary-project",
			sessionId: "temporary-child",
			totalTokens: 28,
		});
	});

	it("deduplicates subagent usage copied from temporary to persistent storage", () => {
		const packageDir = join(tempDir, "pi-codex-subagents");
		const persistentRunsDir = join(packageDir, "runs");
		const temporaryRunsDir = join(process.env.TMPDIR!, "pi-codex-subagents", userInfo().username, "runs");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(packageDir, "config.json"), JSON.stringify({ storageDir: "runs" }), "utf-8");
		const lines = [
			{ type: "session", cwd: "/Users/test/copied-project" },
			assistantUsage("2026-04-02T10:05:00.000Z", 30, 9),
		];
		writeSubagentSessionFile(persistentRunsDir, "parent-scope", "copied-child.jsonl", lines);
		writeSubagentSessionFile(temporaryRunsDir, "parent-scope", "copied-child.jsonl", lines);

		const records = scanAllSessions();
		expect(records).toHaveLength(1);
		expect(records[0].totalTokens).toBe(39);
	});

	it("uses cache until refreshCachedRecords is called", () => {
		writeSessionFile(tempDir, "project-a", "2026-04-02T13-55-08-857Z_session-a.jsonl", [
			{
				type: "message",
				timestamp: "2026-04-02T10:01:00.000Z",
				message: {
					role: "assistant",
					usage: { input: 1, output: 2, cost: { total: 0.01 } },
				},
			},
		]);

		const first = scanAllSessions();
		expect(first).toHaveLength(1);

		writeSessionFile(tempDir, "project-b", "2026-04-02T13-56-08-857Z_session-b.jsonl", [
			{
				type: "message",
				timestamp: "2026-04-02T10:02:00.000Z",
				message: {
					role: "assistant",
					usage: { input: 3, output: 4, cost: { total: 0.02 } },
				},
			},
		]);

		const second = scanAllSessions();
		expect(second).toHaveLength(1);

		refreshCachedRecords();
		const third = scanAllSessions();
		expect(third).toHaveLength(2);
	});

	it("parses subagents:record usageRecords into individual usage rows", () => {
		writeSessionFile(tempDir, "project-sub", "2026-04-02T13-55-08-857Z_session-sub.jsonl", [
			{ type: "session", cwd: "/Users/test/sub-project" },
			{
				type: "custom",
				customType: "subagents:record",
				timestamp: "2026-04-02T10:05:00.000Z",
				data: {
					id: "agent-abc",
					status: "completed",
					usageRecords: [
						{
							timestamp: new Date("2026-04-02T10:00:00.000Z").getTime(),
							provider: "openai-codex",
							model: "gpt-5.6",
							usage: {
								input: 100,
								output: 50,
								cacheRead: 25,
								cacheWrite: 10,
								totalTokens: 185,
								cost: { total: 0.42 },
							},
						},
						{
							timestamp: new Date("2026-04-02T10:02:00.000Z").getTime(),
							provider: "openai-codex",
							model: "gpt-5.6",
							usage: {
								input: 20,
								output: 10,
								cost: { total: 0.08 },
							},
						},
					],
				},
			},
		]);

		const records = scanAllSessions();
		const subRecords = records.filter((r) => r.provider === "openai-codex");
		expect(subRecords).toHaveLength(2);
		expect(subRecords.map((r) => r.totalTokens)).toEqual([185, 30]);
		expect(subRecords[0].project).toBe("/Users/test/sub-project");
		expect(subRecords[0].sessionId).toBe("session-sub");
		expect(subRecords[0].costTotal).toBe(0.42);
		expect(subRecords[1].costTotal).toBe(0.08);
	});

	it("deduplicates subagents:record usageRecords across re-scans", () => {
		writeSessionFile(tempDir, "project-dedup", "2026-04-02T13-55-08-857Z_session-dedup.jsonl", [
			{
				type: "custom",
				customType: "subagents:record",
				timestamp: "2026-04-02T10:05:00.000Z",
				data: {
					id: "agent-dedup",
					usageRecords: [
						{
							timestamp: new Date("2026-04-02T10:00:00.000Z").getTime(),
							provider: "openai-codex",
							model: "gpt-5.6",
							usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0.01 } },
						},
					],
				},
			},
		]);

		expect(scanAllSessions()).toHaveLength(1);
		refreshCachedRecords();
		expect(scanAllSessions()).toHaveLength(1);
	});

	it("ignores malformed and incomplete usage entries", () => {
		writeSessionFile(tempDir, "project-a", "2026-04-02T13-55-08-857Z_session-a.jsonl", [
			{ type: "message", timestamp: "2026-04-02T10:00:00.000Z", message: { role: "assistant" } },
			{ type: "message", timestamp: "2026-04-02T10:01:00.000Z", message: { role: "assistant", usage: { input: "bad", output: 1 } } },
			{ type: "message", timestamp: "2026-04-02T10:02:00.000Z", message: { role: "assistant", usage: { input: 5, output: 6 } } },
		]);

		const records = scanAllSessions();
		expect(records).toHaveLength(1);
		expect(records[0].costTotal).toBe(0);
		expect(records[0].provider).toBe("unknown");
		expect(records[0].model).toBe("unknown");
		expect(records[0].totalTokens).toBe(11);
	});
});
