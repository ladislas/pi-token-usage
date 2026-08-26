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
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	const setStatus = vi.fn();
	const notify = vi.fn();
	const pi = {
		on: vi.fn((name: string, handler: (event: unknown, ctx: any) => unknown) => {
			handlers.set(name, handler);
		}),
		registerCommand: vi.fn((name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) => {
			commands.set(name, command);
		}),
	};
	const ctx = {
		cwd,
		ui: {
			notify,
			setStatus,
			theme: { fg: (_name: string, text: string) => text },
		},
	};

	tokenUsageExtension(pi as any);

	return { commands, handlers, ctx, notify, setStatus };
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

describe("usage command progress", () => {
	it("shows a renderable status before scanning usage history", async () => {
		const cwd = makeTempDir();
		const { commands, ctx, setStatus } = createHarness(cwd);
		const usageCommand = commands.get("usage");
		expect(usageCommand).toBeDefined();

		const pending = usageCommand!.handler("", ctx);

		expect(setStatus).toHaveBeenCalledWith("token-usage-scan", "Scanning usage history…");
		expect(scanAllSessions).not.toHaveBeenCalled();

		await pending;

		expect(scanAllSessions).toHaveBeenCalledOnce();
		expect(setStatus).toHaveBeenLastCalledWith("token-usage-scan", undefined);
	});

	it("clears the status when scanning fails", async () => {
		const cwd = makeTempDir();
		const { commands, ctx, setStatus } = createHarness(cwd);
		vi.mocked(scanAllSessions).mockImplementationOnce(() => {
			throw new Error("scan failed");
		});

		const pending = commands.get("usage")!.handler("models", ctx);

		expect(setStatus).toHaveBeenCalledWith("token-usage-scan", "Scanning usage history…");
		await expect(pending).rejects.toThrow("scan failed");
		expect(setStatus).toHaveBeenLastCalledWith("token-usage-scan", undefined);
	});

	it.each(["help", "?", "--help", "footer", "footer vars"])("does not show scan progress for /usage %s", async (args) => {
		const cwd = makeTempDir();
		const { commands, ctx, setStatus } = createHarness(cwd);

		await commands.get("usage")!.handler(args, ctx);

		expect(scanAllSessions).not.toHaveBeenCalled();
		expect(setStatus).not.toHaveBeenCalledWith("token-usage-scan", expect.anything());
	});

	it("shows progress when enabling the footer triggers a scan", async () => {
		const cwd = makeTempDir();
		const { commands, ctx, setStatus } = createHarness(cwd);

		const pending = commands.get("usage")!.handler("footer on", ctx);

		expect(setStatus).toHaveBeenCalledWith("token-usage-scan", "Scanning usage history…");
		expect(scanAllSessions).not.toHaveBeenCalled();

		await pending;

		expect(scanAllSessions).toHaveBeenCalledOnce();
		expect(setStatus).toHaveBeenLastCalledWith("token-usage-scan", undefined);
	});

	it("does not invalidate the cache twice when refresh also updates an enabled footer", async () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, ".pi-token-usage.json"), JSON.stringify({ enabled: true }));
		const { commands, ctx } = createHarness(cwd);

		await commands.get("usage")!.handler("refresh", ctx);

		expect(refreshCachedRecords).toHaveBeenCalledOnce();
		expect(scanAllSessions).toHaveBeenCalledTimes(2);
	});
});
