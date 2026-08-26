import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/scan", () => ({
	refreshCachedRecords: vi.fn(),
	scanAllSessions: vi.fn(() => []),
}));

import tokenUsageExtension from "../src/index";
import { refreshCachedRecords, scanAllSessions } from "../src/scan";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-token-usage-index-"));
	tempDirs.push(dir);
	return dir;
}

function createHarness(cwd: string) {
	const handlers = new Map<string, (event: unknown, ctx: any) => unknown>();
	const setStatus = vi.fn();
	const pi = {
		on: vi.fn((name: string, handler: (event: unknown, ctx: any) => unknown) => {
			handlers.set(name, handler);
		}),
		registerCommand: vi.fn(),
	};
	const ctx = {
		cwd,
		ui: {
			setStatus,
			theme: { fg: (_name: string, text: string) => text },
		},
	};

	tokenUsageExtension(pi as any);

	return { handlers, ctx, setStatus };
}

afterEach(() => {
	vi.clearAllMocks();
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("footer lifecycle", () => {
	it.each(["session_start", "turn_end"])("skips session scanning on %s when the footer is disabled", async (eventName) => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, ".pi-token-usage.json"), JSON.stringify({ enabled: false }));
		const { handlers, ctx, setStatus } = createHarness(cwd);

		await handlers.get(eventName)?.({}, ctx);

		expect(refreshCachedRecords).not.toHaveBeenCalled();
		expect(scanAllSessions).not.toHaveBeenCalled();
		expect(setStatus).toHaveBeenCalledWith("token-usage", undefined);
	});

	it.each(["session_start", "turn_end"])("refreshes usage data on %s when the footer is enabled", async (eventName) => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, ".pi-token-usage.json"), JSON.stringify({ enabled: true }));
		const { handlers, ctx } = createHarness(cwd);

		await handlers.get(eventName)?.({}, ctx);

		expect(refreshCachedRecords).toHaveBeenCalledOnce();
		expect(scanAllSessions).toHaveBeenCalledOnce();
	});
});
