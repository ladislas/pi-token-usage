import { D, RST } from "./ansi";
import { aggregateByKey } from "./aggregate";
import { colorCost, fmtCost, fmtTokens, pad, padL, visibleWidth } from "./format";
import { TableWidths, Totals, UsageRecord } from "./types";

export function computeWidths(firstHeader: string, rows: Array<{ first: string; totals: Totals }>): TableWidths {
	let first = visibleWidth(firstHeader);
	let input = visibleWidth("Input");
	let output = visibleWidth("Output");
	let cacheRead = visibleWidth("Cache R");
	let cacheWrite = visibleWidth("Cache W");
	let cost = visibleWidth("Cost");

	for (const row of rows) {
		first = Math.max(first, visibleWidth(row.first));
		input = Math.max(input, visibleWidth(fmtTokens(row.totals.input)));
		output = Math.max(output, visibleWidth(fmtTokens(row.totals.output)));
		cacheRead = Math.max(cacheRead, visibleWidth(fmtTokens(row.totals.cacheRead)));
		cacheWrite = Math.max(cacheWrite, visibleWidth(fmtTokens(row.totals.cacheWrite)));
		cost = Math.max(cost, visibleWidth(fmtCost(row.totals.costTotal)));
	}

	return { first, input, output, cacheRead, cacheWrite, cost };
}

export function renderHeader(firstHeader: string, widths: TableWidths): string {
	return (
		`  ${D}${padL(firstHeader, widths.first)}${RST}` +
		`  ${D}${pad("Input", widths.input)}${RST}` +
		`   ${D}${pad("Output", widths.output)}${RST}` +
		`   ${D}${pad("Cache R", widths.cacheRead)}${RST}` +
		`   ${D}${pad("Cache W", widths.cacheWrite)}${RST}` +
		`   ${D}${pad("Cost", widths.cost)}${RST}`
	);
}

export function renderTotalsLine(label: string, t: Totals, widths: TableWidths): string {
	return (
		`  ${padL(label, widths.first)}` +
		`  ${pad(fmtTokens(t.input), widths.input)}` +
		`   ${pad(fmtTokens(t.output), widths.output)}` +
		`   ${pad(fmtTokens(t.cacheRead), widths.cacheRead)}` +
		`   ${pad(fmtTokens(t.cacheWrite), widths.cacheWrite)}` +
		`   ${pad(colorCost(t.costTotal), widths.cost)}`
	);
}

export function renderModelBreakdown(records: UsageRecord[], widths: TableWidths): string[] {
	const byModel = aggregateByKey(records, (r) => `${r.provider}/${r.model}`);
	const sorted = [...byModel.entries()].sort((a, b) => b[1].costTotal - a[1].costTotal);
	const lines: string[] = [];

	lines.push(renderHeader("Model", widths));
	for (const [model, totals] of sorted) {
		lines.push(renderTotalsLine(model, totals, widths));
	}

	return lines;
}
