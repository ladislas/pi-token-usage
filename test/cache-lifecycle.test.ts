import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import tokenUsageExtension from "../src/index";
import { refreshCachedRecords, scanAllSessions } from "../src/scan";

function usageLine(timestamp: string, input: number, output: number): string {
	return `${JSON.stringify({
		type: "message",
		timestamp,
		message: {
			role: "assistant",
			provider: "test",
			model: "test-model",
			usage: { input, output, cost: { total: 0 } },
		},
	})}\n`;
}

describe("usage cache lifecycle", () => {
	let tempDir: string;
	let originalAgentDir: string | undefined;

	beforeEach(() => {
		originalAgentDir = process.env.PI_CODING_AGENT_DIR;
		tempDir = mkdtempSync(join(tmpdir(), "pi-token-usage-lifecycle-"));
		process.env.PI_CODING_AGENT_DIR = tempDir;
		refreshCachedRecords();
	});

	afterEach(() => {
		vi.useRealTimers();
		refreshCachedRecords();
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("rescans updated session files on the first /usage after turn_end", async () => {
		vi.useFakeTimers();
		const projectDir = join(tempDir, "project");
		const sessionDir = join(tempDir, "sessions", "project");
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(sessionDir, { recursive: true });
		writeFileSync(join(projectDir, ".pi-token-usage.json"), JSON.stringify({ enabled: false }));
		const sessionFile = join(sessionDir, "2026-08-26T00-00-00-000Z_session.jsonl");
		writeFileSync(sessionFile, usageLine("2026-08-26T00:00:00.000Z", 100, 50));

		const handlers = new Map<string, (event: unknown, ctx: any) => unknown>();
		let usageCommand: ((args: string, ctx: any) => Promise<void>) | undefined;
		tokenUsageExtension({
			on: (name: string, handler: (event: unknown, ctx: any) => unknown) => handlers.set(name, handler),
			registerCommand: (name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) => {
				if (name === "usage") usageCommand = command.handler;
			},
		} as any);
		const ctx = {
			cwd: projectDir,
			ui: {
				notify: () => {},
				setStatus: () => {},
				setWidget: () => {},
				theme: { fg: (_name: string, text: string) => text },
			},
		};

		const firstUsage = usageCommand!("", ctx);
		await vi.advanceTimersByTimeAsync(50);
		await firstUsage;
		expect(scanAllSessions()).toHaveLength(1);

		appendFileSync(sessionFile, usageLine("2026-08-26T00:01:00.000Z", 200, 100));
		expect(scanAllSessions()).toHaveLength(1);

		await handlers.get("turn_end")?.({}, ctx);

		const secondUsage = usageCommand!("", ctx);
		await vi.advanceTimersByTimeAsync(50);
		await secondUsage;
		expect(scanAllSessions()).toHaveLength(2);
	});
});
