import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const scan = vi.hoisted(() => ({
	scanAllSessions: vi.fn(() => []),
	scanSessionsSince: vi.fn(() => []),
	refreshCachedRecords: vi.fn(),
}));
vi.mock("../src/scan", () => scan);

import registerExtension from "../src/index";
import { todayStart } from "../src/dates";

function registerSessionStart() {
	let handler: ((event: unknown, ctx: unknown) => Promise<void>) | undefined;
	const pi = {
		on: (event: string, cb: (e: unknown, ctx: unknown) => Promise<void>) => {
			if (event === "session_start") handler = cb;
		},
		registerCommand: () => {},
	};
	registerExtension(pi as never);
	if (!handler) throw new Error("session_start handler was not registered");
	return handler;
}

describe("footer lifecycle scan", () => {
	let tempDir: string;
	let originalAgentDir: string | undefined;

	beforeEach(() => {
		originalAgentDir = process.env.PI_CODING_AGENT_DIR;
		tempDir = mkdtempSync(join(tmpdir(), "pi-token-usage-lifecycle-"));
		process.env.PI_CODING_AGENT_DIR = tempDir;
		// Project config overrides the global one, so the test never depends on the home config.
		writeFileSync(join(tempDir, ".pi-token-usage.json"), JSON.stringify({ enabled: true }), "utf-8");
		vi.clearAllMocks();
	});

	afterEach(() => {
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		rmSync(tempDir, { recursive: true, force: true });
	});

	const ctx = () => ({ cwd: tempDir, ui: { setStatus: vi.fn(), theme: { fg: (_c: string, text: string) => text } } });

	it("scans only the today window and never the full history", async () => {
		const handler = registerSessionStart();
		await handler({}, ctx());

		expect(scan.scanSessionsSince).toHaveBeenCalledTimes(1);
		expect(scan.scanSessionsSince).toHaveBeenCalledWith(todayStart());
		expect(scan.scanAllSessions).not.toHaveBeenCalled();
		expect(scan.refreshCachedRecords).toHaveBeenCalled();
	});

	it("skips the scan entirely when the footer is disabled", async () => {
		writeFileSync(join(tempDir, ".pi-token-usage.json"), JSON.stringify({ enabled: false }), "utf-8");

		const handler = registerSessionStart();
		const context = ctx();
		await handler({}, context);

		expect(scan.scanSessionsSince).not.toHaveBeenCalled();
		expect(scan.scanAllSessions).not.toHaveBeenCalled();
		expect(context.ui.setStatus).toHaveBeenCalledWith("token-usage", undefined);
	});
});
