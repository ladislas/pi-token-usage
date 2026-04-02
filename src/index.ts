/**
 * pi-token-usage — Lifetime token usage tracking and cost analytics
 *
 * Scans all pi session JSONL files and aggregates usage data from assistant messages.
 *
 * Commands:
 *   /usage              — Summary: lifetime, this month, last 30d, last 7d, today + today's model breakdown
 *   /usage models       — Full breakdown by provider/model
 *   /usage sessions [N] — Top N sessions by cost (default: 20)
 *   /usage days [N]     — Daily rollup for last N days (default: 7)
 *   /usage months       — Monthly rollup
 *   /usage projects     — Breakdown by project
 *   /usage refresh      — Force rescan
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// ── Types ───────────────────────────────────────────────────────────────────

interface UsageRecord {
	timestamp: number; // Unix ms
	isoTimestamp: string;
	provider: string;
	model: string;
	project: string;
	sessionId: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costTotal: number;
}

// ── ANSI helpers ────────────────────────────────────────────────────────────

const RST = "\x1b[0m";
const B = "\x1b[1m";
const D = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

// ── Formatting ──────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
	if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

function fmtCost(n: number): string {
	if (n >= 100) return `$${n.toFixed(0)}`;
	if (n >= 10) return `$${n.toFixed(1)}`;
	if (n >= 0.01) return `$${n.toFixed(2)}`;
	if (n >= 0.001) return `$${n.toFixed(3)}`;
	if (n === 0) return "$0.00";
	return `$${n.toFixed(4)}`;
}

function colorCost(n: number): string {
	const s = fmtCost(n);
	if (n >= 10) return `${RED}${s}${RST}`;
	if (n >= 1) return `${YELLOW}${s}${RST}`;
	return `${GREEN}${s}${RST}`;
}

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleWidth(s: string): number {
	return stripAnsi(s).length;
}

function pad(s: string, width: number): string {
	const len = visibleWidth(s);
	return len >= width ? s : " ".repeat(width - len) + s;
}

function padL(s: string, width: number): string {
	const len = visibleWidth(s);
	return len >= width ? s : s + " ".repeat(width - len);
}

// ── Date helpers ────────────────────────────────────────────────────────────

function toDateStr(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function toMonthStr(ts: number): string {
	return toDateStr(ts).slice(0, 7); // YYYY-MM
}

function daysAgo(n: number): number {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - n);
	return d.getTime();
}

function todayStart(): number {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

// ── Session path helpers ────────────────────────────────────────────────────

function getSessionsDir(): string {
	const envDir = (process.env.PI_CODING_AGENT_DIR ?? "").trim();
	if (envDir) return join(envDir, "sessions");
	return join(homedir(), ".pi", "agent", "sessions");
}

function decodeProjectDir(dirName: string): string {
	// Session dir names are lossy (/ becomes -), so this is only a fallback.
	return dirName;
}

function projectShortName(project: string): string {
	const parts = project.split("/").filter(Boolean);
	if (parts.length <= 2) return project;
	return parts.slice(-2).join("/");
}

function extractSessionId(filename: string): string {
	// 2026-04-02T13-55-08-857Z_uuid-here.jsonl → uuid-here
	const base = basename(filename, ".jsonl");
	const idx = base.indexOf("_");
	return idx !== -1 ? base.slice(idx + 1) : base;
}

// ── Scanner ─────────────────────────────────────────────────────────────────

let cachedRecords: UsageRecord[] | null = null;

function scanAllSessions(): UsageRecord[] {
	if (cachedRecords) return cachedRecords;

	const sessionsDir = getSessionsDir();
	if (!existsSync(sessionsDir)) {
		cachedRecords = [];
		return cachedRecords;
	}

	const records: UsageRecord[] = [];
	const seen = new Set<string>();

	let projectDirs: string[];
	try {
		projectDirs = readdirSync(sessionsDir);
	} catch {
		cachedRecords = [];
		return cachedRecords;
	}

	for (const projDir of projectDirs) {
		const projPath = join(sessionsDir, projDir);
		let stat;
		try {
			stat = statSync(projPath);
		} catch {
			continue;
		}
		if (!stat.isDirectory()) continue;

		let files: string[];
		try {
			files = readdirSync(projPath).filter((f) => f.endsWith(".jsonl"));
		} catch {
			continue;
		}

		for (const file of files) {
			const sessionId = extractSessionId(file);
			const filePath = join(projPath, file);

			let content: string;
			try {
				content = readFileSync(filePath, "utf-8");
			} catch {
				continue;
			}

			const lines = content.split("\n");
			let project = decodeProjectDir(projDir);
			for (const line of lines) {
				if (!line.trim()) continue;

				// Session header gives us the real cwd; use it when available.
				if (line.includes('"type":"session"') && line.includes('"cwd"')) {
					try {
						const header = JSON.parse(line);
						if (typeof header.cwd === "string" && header.cwd.length > 0) {
							project = header.cwd;
						}
					} catch {
						// ignore invalid header lines
					}
					continue;
				}

				// Quick pre-filter before JSON parse
				if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;

				let entry: any;
				try {
					entry = JSON.parse(line);
				} catch {
					continue;
				}

				if (entry.type !== "message") continue;
				const msg = entry.message;
				if (!msg || msg.role !== "assistant" || !msg.usage) continue;

				const usage = msg.usage;
				if (typeof usage.input !== "number" || typeof usage.output !== "number") continue;

				const totalTokens = usage.totalTokens ?? usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);

				// Dedup: timestamp + totalTokens
				const hash = `${entry.timestamp}:${totalTokens}`;
				if (seen.has(hash)) continue;
				seen.add(hash);

				const costTotal = usage.cost?.total ?? 0;

				records.push({
					timestamp: msg.timestamp ?? new Date(entry.timestamp).getTime(),
					isoTimestamp: entry.timestamp,
					provider: msg.provider ?? "unknown",
					model: msg.model ?? "unknown",
					project,
					sessionId,
					input: usage.input,
					output: usage.output,
					cacheRead: usage.cacheRead ?? 0,
					cacheWrite: usage.cacheWrite ?? 0,
					totalTokens,
					costTotal,
				});
			}
		}
	}

	// Sort by timestamp ascending
	records.sort((a, b) => a.timestamp - b.timestamp);
	cachedRecords = records;
	return records;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costTotal: number;
	count: number;
}

function emptyTotals(): Totals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0, count: 0 };
}

function addToTotals(t: Totals, r: UsageRecord): void {
	t.input += r.input;
	t.output += r.output;
	t.cacheRead += r.cacheRead;
	t.cacheWrite += r.cacheWrite;
	t.totalTokens += r.totalTokens;
	t.costTotal += r.costTotal;
	t.count++;
}

function aggregateByKey(records: UsageRecord[], keyFn: (r: UsageRecord) => string): Map<string, Totals> {
	const map = new Map<string, Totals>();
	for (const r of records) {
		const key = keyFn(r);
		let t = map.get(key);
		if (!t) {
			t = emptyTotals();
			map.set(key, t);
		}
		addToTotals(t, r);
	}
	return map;
}

function filterSince(records: UsageRecord[], sinceMs: number): UsageRecord[] {
	return records.filter((r) => r.timestamp >= sinceMs);
}

// ── Table rendering ─────────────────────────────────────────────────────────

function renderTotalsLine(label: string, t: Totals, labelWidth: number = 16): string {
	return (
		`  ${D}${padL(label, labelWidth)}${RST}` +
		`  ${pad(fmtTokens(t.input), 9)}` +
		`  ${pad(fmtTokens(t.output), 9)}` +
		`  ${pad(fmtTokens(t.cacheRead), 9)}` +
		`  ${pad(fmtTokens(t.cacheWrite), 9)}` +
		`  ${pad(colorCost(t.costTotal), 18)}`
	);
}

function renderHeader(labelWidth: number = 16): string {
	return (
		`  ${D}${padL("", labelWidth)}` +
		`  ${pad("Input", 9)}` +
		`  ${pad("Output", 9)}` +
		`  ${pad("Cache R", 9)}` +
		`  ${pad("Cache W", 9)}` +
		`  ${pad("Cost", 9)}${RST}`
	);
}

function renderModelBreakdown(records: UsageRecord[], indent: string = "    "): string[] {
	const byModel = aggregateByKey(records, (r) => `${r.provider}/${r.model}`);
	const sorted = [...byModel.entries()].sort((a, b) => b[1].costTotal - a[1].costTotal);
	const lines: string[] = [];

	lines.push(
		`${indent}${D}${padL("Model", 30)}${RST}` +
			`  ${D}${pad("Input", 9)}` +
			`  ${pad("Output", 9)}` +
			`  ${pad("Cache R", 9)}` +
			`  ${pad("Cache W", 9)}` +
			`  ${pad("Cost", 9)}${RST}`,
	);

	for (const [model, t] of sorted) {
		const shortModel = model.length > 30 ? model.slice(0, 28) + ".." : model;
		lines.push(
			`${indent}${padL(shortModel, 30)}` +
				`  ${pad(fmtTokens(t.input), 9)}` +
				`  ${pad(fmtTokens(t.output), 9)}` +
				`  ${pad(fmtTokens(t.cacheRead), 9)}` +
				`  ${pad(fmtTokens(t.cacheWrite), 9)}` +
				`  ${pad(colorCost(t.costTotal), 18)}`,
		);
	}
	return lines;
}

// ── Commands ────────────────────────────────────────────────────────────────

function cmdUsageSummary(): string {
	const records = scanAllSessions();

	if (records.length === 0) {
		return "No usage data found. Make sure you have pi sessions in ~/.pi/agent/sessions/";
	}

	const now = Date.now();
	const todayMs = todayStart();
	const last7d = daysAgo(7);
	const last30d = daysAgo(30);
	const thisMonth = toMonthStr(now);

	const lifetime = emptyTotals();
	const todayT = emptyTotals();
	const last7T = emptyTotals();
	const last30T = emptyTotals();
	const monthT = emptyTotals();
	const todayRecords: UsageRecord[] = [];

	for (const r of records) {
		addToTotals(lifetime, r);
		if (r.timestamp >= todayMs) {
			addToTotals(todayT, r);
			todayRecords.push(r);
		}
		if (r.timestamp >= last7d) addToTotals(last7T, r);
		if (r.timestamp >= last30d) addToTotals(last30T, r);
		if (toMonthStr(r.timestamp) === thisMonth) addToTotals(monthT, r);
	}

	const lines: string[] = [];
	lines.push(`${B}${CYAN}── Token Usage ──${RST}`);
	lines.push(renderHeader());
	lines.push(renderTotalsLine("Lifetime", lifetime));
	lines.push(renderTotalsLine("This month", monthT));
	lines.push(renderTotalsLine("Last 30 days", last30T));
	lines.push(renderTotalsLine("Last 7 days", last7T));
	lines.push(renderTotalsLine("Today", todayT));

	if (todayRecords.length > 0) {
		lines.push("");
		lines.push(`${B}${CYAN}── Today by Model ──${RST}`);
		lines.push(...renderModelBreakdown(todayRecords));
	}

	lines.push("");
	lines.push(`${D}${records.length} messages across ${new Set(records.map((r) => r.sessionId)).size} sessions${RST}`);

	return lines.join("\n");
}

function cmdUsageModels(): string {
	const records = scanAllSessions();
	if (records.length === 0) return "No usage data found.";

	const byModel = aggregateByKey(records, (r) => `${r.provider}/${r.model}`);
	const sorted = [...byModel.entries()].sort((a, b) => b[1].costTotal - a[1].costTotal);

	const lines: string[] = [];
	lines.push(`${B}${CYAN}── Usage by Model ──${RST}`);
	lines.push(
		`  ${D}${padL("Model", 30)}` +
			`  ${pad("Input", 9)}` +
			`  ${pad("Output", 9)}` +
			`  ${pad("Cache R", 9)}` +
			`  ${pad("Cache W", 9)}` +
			`  ${pad("Cost", 9)}` +
			`  ${pad("Msgs", 6)}${RST}`,
	);

	for (const [model, t] of sorted) {
		const shortModel = model.length > 30 ? model.slice(0, 28) + ".." : model;
		lines.push(
			`  ${padL(shortModel, 30)}` +
				`  ${pad(fmtTokens(t.input), 9)}` +
				`  ${pad(fmtTokens(t.output), 9)}` +
				`  ${pad(fmtTokens(t.cacheRead), 9)}` +
				`  ${pad(fmtTokens(t.cacheWrite), 9)}` +
				`  ${pad(colorCost(t.costTotal), 18)}` +
				`  ${pad(String(t.count), 6)}`,
		);
	}

	return lines.join("\n");
}

function cmdUsageDays(n: number): string {
	const records = scanAllSessions();
	if (records.length === 0) return "No usage data found.";

	const sinceMs = daysAgo(n);
	const recent = filterSince(records, sinceMs);

	if (recent.length === 0) return `No usage data in the last ${n} days.`;

	const byDay = aggregateByKey(recent, (r) => toDateStr(r.timestamp));
	const sorted = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));

	const lifetime = emptyTotals();
	for (const r of recent) addToTotals(lifetime, r);

	const lines: string[] = [];
	lines.push(`${B}${CYAN}── Daily Usage (${n} days) ──${RST}`);
	lines.push(renderHeader(12));

	for (const [day, t] of sorted) {
		lines.push(renderTotalsLine(day, t, 12));

		// Per-model breakdown for each day
		const dayRecords = recent.filter((r) => toDateStr(r.timestamp) === day);
		const modelBreakdown = renderModelBreakdown(dayRecords, "      ");
		if (modelBreakdown.length > 1) {
			lines.push(...modelBreakdown);
		}
	}

	lines.push("");
	lines.push(`${B}${renderTotalsLine("Total", lifetime, 12)}${RST}`);

	return lines.join("\n");
}

function cmdUsageMonths(): string {
	const records = scanAllSessions();
	if (records.length === 0) return "No usage data found.";

	const byMonth = aggregateByKey(records, (r) => toMonthStr(r.timestamp));
	const sorted = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));

	const lifetime = emptyTotals();
	for (const r of records) addToTotals(lifetime, r);

	const lines: string[] = [];
	lines.push(`${B}${CYAN}── Monthly Usage ──${RST}`);
	lines.push(renderHeader(10));

	for (const [month, t] of sorted) {
		lines.push(renderTotalsLine(month, t, 10));

		// Per-model breakdown for each month
		const monthRecords = records.filter((r) => toMonthStr(r.timestamp) === month);
		const modelBreakdown = renderModelBreakdown(monthRecords, "      ");
		if (modelBreakdown.length > 1) {
			lines.push(...modelBreakdown);
		}
	}

	lines.push("");
	lines.push(`${B}${renderTotalsLine("Total", lifetime, 10)}${RST}`);

	return lines.join("\n");
}

function cmdUsageSessions(n: number): string {
	const records = scanAllSessions();
	if (records.length === 0) return "No usage data found.";

	const bySession = aggregateByKey(records, (r) => r.sessionId);
	const sorted = [...bySession.entries()].sort((a, b) => b[1].costTotal - a[1].costTotal).slice(0, n);

	// Build session → project map
	const sessionProject = new Map<string, string>();
	for (const r of records) {
		if (!sessionProject.has(r.sessionId)) {
			sessionProject.set(r.sessionId, r.project);
		}
	}

	const lines: string[] = [];
	lines.push(`${B}${CYAN}── Top ${n} Sessions by Cost ──${RST}`);
	lines.push(
		`  ${D}${padL("Session", 20)}` +
			`  ${padL("Project", 20)}` +
			`  ${pad("Input", 9)}` +
			`  ${pad("Output", 9)}` +
			`  ${pad("Cost", 9)}` +
			`  ${pad("Msgs", 6)}${RST}`,
	);

	for (const [sessionId, t] of sorted) {
		const proj = projectShortName(sessionProject.get(sessionId) ?? "unknown");
		const shortId = sessionId.length > 20 ? sessionId.slice(0, 18) + ".." : sessionId;
		const shortProj = proj.length > 20 ? proj.slice(0, 18) + ".." : proj;
		lines.push(
			`  ${padL(shortId, 20)}` +
				`  ${D}${padL(shortProj, 20)}${RST}` +
				`  ${pad(fmtTokens(t.input), 9)}` +
				`  ${pad(fmtTokens(t.output), 9)}` +
				`  ${pad(colorCost(t.costTotal), 18)}` +
				`  ${pad(String(t.count), 6)}`,
		);
	}

	return lines.join("\n");
}

function cmdUsageProjects(): string {
	const records = scanAllSessions();
	if (records.length === 0) return "No usage data found.";

	const byProject = aggregateByKey(records, (r) => r.project);
	const sorted = [...byProject.entries()].sort((a, b) => b[1].costTotal - a[1].costTotal);

	const lines: string[] = [];
	lines.push(`${B}${CYAN}── Usage by Project ──${RST}`);
	lines.push(
		`  ${D}${padL("Project", 35)}` +
			`  ${pad("Input", 9)}` +
			`  ${pad("Output", 9)}` +
			`  ${pad("Cost", 9)}` +
			`  ${pad("Msgs", 6)}` +
			`  ${pad("Sessions", 8)}${RST}`,
	);

	for (const [project, t] of sorted) {
		const shortProj = projectShortName(project);
		const displayProj = shortProj.length > 35 ? shortProj.slice(0, 33) + ".." : shortProj;
		const sessionCount = new Set(records.filter((r) => r.project === project).map((r) => r.sessionId)).size;
		lines.push(
			`  ${padL(displayProj, 35)}` +
				`  ${pad(fmtTokens(t.input), 9)}` +
				`  ${pad(fmtTokens(t.output), 9)}` +
				`  ${pad(colorCost(t.costTotal), 18)}` +
				`  ${pad(String(t.count), 6)}` +
				`  ${pad(String(sessionCount), 8)}`,
		);
	}

	return lines.join("\n");
}

// ── Extension entry point ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "Token usage analytics — lifetime, by model, day, month, session, project",
		handler: async (args, ctx) => {
			const parts = (args ?? "").trim().split(/\s+/);
			const sub = parts[0]?.toLowerCase();

			let output: string;

			switch (sub) {
				case "models":
					output = cmdUsageModels();
					break;
				case "days": {
					const n = parseInt(parts[1]) || 7;
					output = cmdUsageDays(n);
					break;
				}
				case "months":
					output = cmdUsageMonths();
					break;
				case "sessions": {
					const n = parseInt(parts[1]) || 20;
					output = cmdUsageSessions(n);
					break;
				}
				case "projects":
					output = cmdUsageProjects();
					break;
				case "refresh":
					cachedRecords = null;
					output = cmdUsageSummary();
					ctx.ui.notify("Cache cleared and data rescanned.", "info");
					break;
				default:
					output = cmdUsageSummary();
					break;
			}

			ctx.ui.notify(output, "info");
		},
	});
}
