import { B, CYAN, D, RST } from "./ansi";
import { addToTotals, aggregateByKey, emptyTotals, filterSince } from "./aggregate";
import { daysAgo, toDateStr, toMonthStr, todayStart } from "./dates";
import { colorCost, fmtTokens, pad, padL, visibleWidth } from "./format";
import { projectShortName } from "./paths";
import { refreshCachedRecords, scanAllSessions } from "./scan";
import { computeWidths, renderHeader, renderModelBreakdown, renderTotalsLine } from "./tables";

export function cmdUsageSummary(): string {
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
	const todayRecords = [];

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

	const summaryRows = [
		{ first: "Lifetime", totals: lifetime },
		{ first: "This month", totals: monthT },
		{ first: "Last 30 days", totals: last30T },
		{ first: "Last 7 days", totals: last7T },
		{ first: "Today", totals: todayT },
	];
	const todayModelRows = [...aggregateByKey(todayRecords, (r) => `${r.provider}/${r.model}`).entries()].map(
		([first, totals]) => ({ first, totals }),
	);
	const todayProjectRows = [...aggregateByKey(todayRecords, (r) => projectShortName(r.project)).entries()].map(
		([first, totals]) => ({ first, totals }),
	);
	const widths = computeWidths("Period", [...summaryRows, ...todayModelRows, ...todayProjectRows]);

	const lines: string[] = [];
	lines.push(`${B}${CYAN}── Token Usage ──${RST}`);
	lines.push(renderHeader("Period", widths));
	lines.push(renderTotalsLine("Lifetime", lifetime, widths));
	lines.push(renderTotalsLine("This month", monthT, widths));
	lines.push(renderTotalsLine("Last 30 days", last30T, widths));
	lines.push(renderTotalsLine("Last 7 days", last7T, widths));
	lines.push(renderTotalsLine("Today", todayT, widths));

	if (todayRecords.length > 0) {
		lines.push("");
		lines.push(`${B}${CYAN}── Today by Model ──${RST}`);
		lines.push(...renderModelBreakdown(todayRecords, widths));
		lines.push("");
		lines.push(`${B}${CYAN}── Today by Project ──${RST}`);
		lines.push(renderHeader("Project", widths));
		for (const [project, totals] of [...aggregateByKey(todayRecords, (r) => projectShortName(r.project)).entries()].sort(
			(a, b) => b[1].costTotal - a[1].costTotal,
		)) {
			lines.push(renderTotalsLine(project, totals, widths));
		}
	}

	lines.push("");
	lines.push(`${D}${records.length} messages across ${new Set(records.map((r) => r.sessionId)).size} sessions${RST}`);
	return lines.join("\n");
}

export function cmdUsageModels(): string {
	const records = scanAllSessions();
	if (records.length === 0) return "No usage data found.";

	const byModel = aggregateByKey(records, (r) => `${r.provider}/${r.model}`);
	const sorted = [...byModel.entries()].sort((a, b) => b[1].costTotal - a[1].costTotal);
	const rows = sorted.map(([model, totals]) => ({
		model,
		input: fmtTokens(totals.input),
		output: fmtTokens(totals.output),
		cacheRead: fmtTokens(totals.cacheRead),
		cacheWrite: fmtTokens(totals.cacheWrite),
		cost: colorCost(totals.costTotal),
		msgs: String(totals.count),
	}));

	const widths = {
		model: Math.max(visibleWidth("Model"), ...rows.map((r) => visibleWidth(r.model))),
		input: Math.max(visibleWidth("Input"), ...rows.map((r) => visibleWidth(r.input))),
		output: Math.max(visibleWidth("Output"), ...rows.map((r) => visibleWidth(r.output))),
		cacheRead: Math.max(visibleWidth("Cache R"), ...rows.map((r) => visibleWidth(r.cacheRead))),
		cacheWrite: Math.max(visibleWidth("Cache W"), ...rows.map((r) => visibleWidth(r.cacheWrite))),
		cost: Math.max(visibleWidth("Cost"), ...rows.map((r) => visibleWidth(r.cost))),
		msgs: Math.max(visibleWidth("Msgs"), ...rows.map((r) => visibleWidth(r.msgs))),
	};

	const lines: string[] = [];
	lines.push(`${B}${CYAN}── Usage by Model ──${RST}`);
	lines.push(
		`  ${D}${padL("Model", widths.model)}${RST}` +
			`  ${D}${pad("Input", widths.input)}${RST}` +
			`   ${D}${pad("Output", widths.output)}${RST}` +
			`   ${D}${pad("Cache R", widths.cacheRead)}${RST}` +
			`   ${D}${pad("Cache W", widths.cacheWrite)}${RST}` +
			`   ${D}${pad("Cost", widths.cost)}${RST}` +
			`   ${D}${pad("Msgs", widths.msgs)}${RST}`,
	);

	for (const row of rows) {
		lines.push(
			`  ${padL(row.model, widths.model)}` +
				`  ${pad(row.input, widths.input)}` +
				`   ${pad(row.output, widths.output)}` +
				`   ${pad(row.cacheRead, widths.cacheRead)}` +
				`   ${pad(row.cacheWrite, widths.cacheWrite)}` +
				`   ${pad(row.cost, widths.cost)}` +
				`   ${pad(row.msgs, widths.msgs)}`,
		);
	}

	return lines.join("\n");
}

export function cmdUsageDays(n: number): string {
	const records = scanAllSessions();
	if (records.length === 0) return "No usage data found.";

	const recent = filterSince(records, daysAgo(n));
	if (recent.length === 0) return `No usage data in the last ${n} days.`;

	const byDay = aggregateByKey(recent, (r) => toDateStr(r.timestamp));
	const sorted = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
	const total = emptyTotals();
	for (const r of recent) addToTotals(total, r);

	const dayRows = sorted.map(([first, totals]) => ({ first, totals }));
	const modelRows = [...aggregateByKey(recent, (r) => `${r.provider}/${r.model}`).entries()].map(([first, totals]) => ({
		first: `  ${first}`,
		totals,
	}));
	const widths = computeWidths("Day", [...dayRows, ...modelRows, { first: "Total", totals: total }]);

	const lines: string[] = [];
	lines.push(`${B}${CYAN}── Daily Usage (${n} days) ──${RST}`);
	lines.push(renderHeader("Day", widths));

	for (const [day, totals] of sorted) {
		lines.push(renderTotalsLine(day, totals, widths));
		const dayRecords = recent.filter((r) => toDateStr(r.timestamp) === day);
		const byModel = aggregateByKey(dayRecords, (r) => `${r.provider}/${r.model}`);
		const sortedModels = [...byModel.entries()].sort((a, b) => b[1].costTotal - a[1].costTotal);
		for (const [model, modelTotals] of sortedModels) {
			lines.push(renderTotalsLine(`  ${model}`, modelTotals, widths));
		}
	}

	lines.push("");
	lines.push(`${B}${renderTotalsLine("Total", total, widths)}${RST}`);
	return lines.join("\n");
}

export function cmdUsageMonths(): string {
	const records = scanAllSessions();
	if (records.length === 0) return "No usage data found.";

	const byMonth = aggregateByKey(records, (r) => toMonthStr(r.timestamp));
	const sorted = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));
	const total = emptyTotals();
	for (const r of records) addToTotals(total, r);

	const monthRows = sorted.map(([first, totals]) => ({ first, totals }));
	const modelRows = [...aggregateByKey(records, (r) => `${r.provider}/${r.model}`).entries()].map(([first, totals]) => ({
		first: `  ${first}`,
		totals,
	}));
	const widths = computeWidths("Month", [...monthRows, ...modelRows, { first: "Total", totals: total }]);

	const lines: string[] = [];
	lines.push(`${B}${CYAN}── Monthly Usage ──${RST}`);
	lines.push(renderHeader("Month", widths));

	for (const [month, totals] of sorted) {
		lines.push(renderTotalsLine(month, totals, widths));
		const monthRecords = records.filter((r) => toMonthStr(r.timestamp) === month);
		const byModel = aggregateByKey(monthRecords, (r) => `${r.provider}/${r.model}`);
		const sortedModels = [...byModel.entries()].sort((a, b) => b[1].costTotal - a[1].costTotal);
		for (const [model, modelTotals] of sortedModels) {
			lines.push(renderTotalsLine(`  ${model}`, modelTotals, widths));
		}
	}

	lines.push("");
	lines.push(`${B}${renderTotalsLine("Total", total, widths)}${RST}`);
	return lines.join("\n");
}

export function cmdUsageSessions(n: number): string {
	const records = scanAllSessions();
	if (records.length === 0) return "No usage data found.";

	const bySession = aggregateByKey(records, (r) => r.sessionId);
	const sorted = [...bySession.entries()].sort((a, b) => b[1].costTotal - a[1].costTotal).slice(0, n);
	const sessionProject = new Map<string, string>();
	for (const r of records) {
		if (!sessionProject.has(r.sessionId)) sessionProject.set(r.sessionId, r.project);
	}

	const rows = sorted.map(([sessionId, totals]) => ({
		session: sessionId,
		project: projectShortName(sessionProject.get(sessionId) ?? "unknown"),
		input: fmtTokens(totals.input),
		output: fmtTokens(totals.output),
		cost: colorCost(totals.costTotal),
		msgs: String(totals.count),
	}));

	const widths = {
		session: Math.max(visibleWidth("Session"), ...rows.map((r) => visibleWidth(r.session))),
		project: Math.max(visibleWidth("Project"), ...rows.map((r) => visibleWidth(r.project))),
		input: Math.max(visibleWidth("Input"), ...rows.map((r) => visibleWidth(r.input))),
		output: Math.max(visibleWidth("Output"), ...rows.map((r) => visibleWidth(r.output))),
		cost: Math.max(visibleWidth("Cost"), ...rows.map((r) => visibleWidth(r.cost))),
		msgs: Math.max(visibleWidth("Msgs"), ...rows.map((r) => visibleWidth(r.msgs))),
	};

	const lines: string[] = [];
	lines.push(`${B}${CYAN}── Top ${n} Sessions by Cost ──${RST}`);
	lines.push(
		`  ${D}${padL("Session", widths.session)}${RST}` +
			`  ${D}${padL("Project", widths.project)}${RST}` +
			`  ${D}${pad("Input", widths.input)}${RST}` +
			`   ${D}${pad("Output", widths.output)}${RST}` +
			`   ${D}${pad("Cost", widths.cost)}${RST}` +
			`   ${D}${pad("Msgs", widths.msgs)}${RST}`,
	);

	for (const row of rows) {
		lines.push(
			`  ${padL(row.session, widths.session)}` +
				`  ${padL(row.project, widths.project)}` +
				`  ${pad(row.input, widths.input)}` +
				`   ${pad(row.output, widths.output)}` +
				`   ${pad(row.cost, widths.cost)}` +
				`   ${pad(row.msgs, widths.msgs)}`,
		);
	}

	return lines.join("\n");
}

export function cmdUsageProjects(): string {
	const records = scanAllSessions();
	if (records.length === 0) return "No usage data found.";

	const byProject = aggregateByKey(records, (r) => r.project);
	const sorted = [...byProject.entries()].sort((a, b) => b[1].costTotal - a[1].costTotal);
	const rows = sorted.map(([project, totals]) => {
		const sessionCount = new Set(records.filter((r) => r.project === project).map((r) => r.sessionId)).size;
		return {
			project: projectShortName(project),
			input: fmtTokens(totals.input),
			output: fmtTokens(totals.output),
			cost: colorCost(totals.costTotal),
			msgs: String(totals.count),
			sessions: String(sessionCount),
		};
	});

	const widths = {
		project: Math.max(visibleWidth("Project"), ...rows.map((r) => visibleWidth(r.project))),
		input: Math.max(visibleWidth("Input"), ...rows.map((r) => visibleWidth(r.input))),
		output: Math.max(visibleWidth("Output"), ...rows.map((r) => visibleWidth(r.output))),
		cost: Math.max(visibleWidth("Cost"), ...rows.map((r) => visibleWidth(r.cost))),
		msgs: Math.max(visibleWidth("Msgs"), ...rows.map((r) => visibleWidth(r.msgs))),
		sessions: Math.max(visibleWidth("Sessions"), ...rows.map((r) => visibleWidth(r.sessions))),
	};

	const lines: string[] = [];
	lines.push(`${B}${CYAN}── Usage by Project ──${RST}`);
	lines.push(
		`  ${D}${padL("Project", widths.project)}${RST}` +
			`  ${D}${pad("Input", widths.input)}${RST}` +
			`   ${D}${pad("Output", widths.output)}${RST}` +
			`   ${D}${pad("Cost", widths.cost)}${RST}` +
			`   ${D}${pad("Msgs", widths.msgs)}${RST}` +
			`   ${D}${pad("Sessions", widths.sessions)}${RST}`,
	);

	for (const row of rows) {
		lines.push(
			`  ${padL(row.project, widths.project)}` +
				`  ${pad(row.input, widths.input)}` +
				`   ${pad(row.output, widths.output)}` +
				`   ${pad(row.cost, widths.cost)}` +
				`   ${pad(row.msgs, widths.msgs)}` +
				`   ${pad(row.sessions, widths.sessions)}`,
		);
	}

	return lines.join("\n");
}

export function cmdUsageHelp(): string {
	return [
		`${B}${CYAN}── Usage Commands ──${RST}`,
		`  ${B}/usage${RST}                                Summary: lifetime, month, 30d, 7d, today`,
		`  ${B}/usage models${RST}                         Breakdown by provider/model`,
		`  ${B}/usage days [N]${RST}                       Daily rollup for last N days (default: 7)`,
		`  ${B}/usage months${RST}                         Monthly rollup`,
		`  ${B}/usage sessions [N]${RST}                   Top N sessions by cost (default: 20)`,
		`  ${B}/usage projects${RST}                       Breakdown by project`,
		`  ${B}/usage footer${RST}                         Show footer config and available items`,
		`  ${B}/usage footer on|off${RST}                  Enable or disable the footer status`,
		`  ${B}/usage footer items <comma-separated>${RST} Customize footer items`,
		`  ${B}/usage footer preset <name>${RST}           Apply an ordering preset`,
		`  ${B}/usage footer separator <text>${RST}        Customize the footer separator`,
		`  ${B}/usage footer label <item> <text>${RST}     Set a custom item label`,
		`  ${B}/usage footer unlabel <item>${RST}          Remove a custom item label`,
		`  ${B}/usage footer reset${RST}                   Remove project footer config`,
		`  ${B}/usage refresh${RST}                        Clear cache and rescan session files`,
		`  ${B}/usage help${RST}                           Show this help`,
		``,
		`${D}Aliases: /usage ?, /usage --help${RST}`,
	].join("\n");
}

export function refreshUsageData(): string {
	refreshCachedRecords();
	return cmdUsageSummary();
}
