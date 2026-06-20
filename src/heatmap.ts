import { B, CYAN, D, RST } from "./ansi";
import { fmtCost } from "./format";
import { scanAllSessions } from "./scan";
import { toDateStr } from "./dates";

// GitHub-style contribution heatmap colors (truecolor ANSI foreground)
const LEVEL_COLORS = [
	"\x1b[38;2;22;27;34m",   // 0: #161b22 — no activity / very dim
	"\x1b[38;2;14;68;41m",   // 1: #0e4429 — light
	"\x1b[38;2;0;109;50m",   // 2: #006d32 — medium-light
	"\x1b[38;2;38;166;65m",  // 3: #26a641 — medium
	"\x1b[38;2;57;211;83m",  // 4: #39d353 — heavy
];

const CELL = "█";
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getLevel(value: number, maxValue: number): number {
	if (value === 0) return 0;
	if (maxValue <= 0) return 0;
	const ratio = value / maxValue;
	if (ratio <= 0.25) return 1;
	if (ratio <= 0.5) return 2;
	if (ratio <= 0.75) return 3;
	return 4;
}

function coloredCell(level: number): string {
	return `${LEVEL_COLORS[level]}${CELL}${RST}`;
}

/**
 * Render a GitHub-style contribution heatmap of token usage costs.
 *
 * Layout (7 rows × ~53 columns):
 *
 *     Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
 *   Sun ████████████████████████████████████████████████████████
 *   Mon ████████████████████████████████████████████████████████
 *   ...
 *   Sat ████████████████████████████████████████████████████████
 *
 *   Less  █ █ █ █ █  More
 *   Scale: $0  $0.25  $0.50  $1.00  $2.00
 */
export function cmdUsageHeatmap(n: number = 365): string {
	const records = scanAllSessions();
	if (records.length === 0) return "No usage data found.";

	// Date range: [today - n + 1, today]
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const start = new Date(today);
	start.setDate(start.getDate() - (n - 1));
	const startMs = start.getTime();
	const endMs = today.getTime() + 86_400_000 - 1;

	// Aggregate daily cost
	const dailyData = new Map<string, number>();
	for (const r of records) {
		if (r.timestamp < startMs || r.timestamp > endMs) continue;
		const day = toDateStr(r.timestamp);
		dailyData.set(day, (dailyData.get(day) ?? 0) + r.costTotal);
	}

	let maxDaily = 0;
	for (const v of dailyData.values()) if (v > maxDaily) maxDaily = v;

	// --- Build grid ---
	// Align grid so the rightmost column ends on today.
	// Grid goes from the Sunday on/before `start` to the Saturday on/after `today`.
	const gridStart = new Date(start);
	gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // back to Sunday

	const gridEnd = new Date(today);
	gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay())); // forward to Saturday

	const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86_400_000) + 1;
	const numWeeks = Math.ceil(totalDays / 7);

	// Weeks[weekIdx] = { cells: [Sun..Sat cost], monthLabel?: string }
	const weeks: Array<{ cells: number[]; monthLabel?: string }> = [];
	const cursor = new Date(gridStart);

	for (let w = 0; w < numWeeks; w++) {
		const info: { cells: number[]; monthLabel?: string } = { cells: [0, 0, 0, 0, 0, 0, 0] };

		for (let d = 0; d < 7; d++) {
			const dateStr = toDateStr(cursor.getTime());
			info.cells[d] = dailyData.get(dateStr) ?? 0;

			// Track the 1st of each month for month labels
			if (cursor.getDate() === 1 && cursor <= today) {
				info.monthLabel = MONTH_NAMES[cursor.getMonth()];
			}

			cursor.setDate(cursor.getDate() + 1);
		}

		weeks.push(info);
	}

	// Mon/Jan 1st is a special case: if it's also the first day in the grid,
	// the label gets placed at week 0.
	// If gridStart is before Jan 1st, the label on Jan 1st's week still works.

	// --- Render ---
	const lines: string[] = [];

	lines.push(`${B}${CYAN}── Token Usage Heatmap ──${RST}`);
	lines.push(`${D}Last ${n} days  ·  daily cost by ${fmtCost(maxDaily)} max${RST}`);
	lines.push("");

	// Month label row
	{
		let monthRow = new Array<string>(numWeeks).fill(" ");
		for (let w = 0; w < numWeeks; w++) {
			const label = weeks[w].monthLabel;
			if (label) {
				for (let c = 0; c < label.length && w + c < numWeeks; c++) {
					monthRow[w + c] = label[c];
				}
			}
		}
		// Left-pad to align with day label column
		lines.push(`      ${monthRow.join("")}`);
	}

	// Day rows (0=Sun..6=Sat)
	for (let d = 0; d < 7; d++) {
		const dayLabel = DAY_LABELS[d];
		let row = `  ${dayLabel}  `;
		for (const week of weeks) {
			const level = getLevel(week.cells[d], maxDaily);
			row += coloredCell(level);
		}
		// Only show day labels on rows that are visible
		// (all 7 are shown for completeness, but label all)
		lines.push(row);
	}

	// Legend row
	lines.push("");
	{
		const legendCells = [0, 1, 2, 3, 4].map((l) => coloredCell(l)).join(" ");
		lines.push(`  Less  ${legendCells}  More`);
	}
	// Cost scale
	if (maxDaily > 0) {
		const p25 = fmtCost(maxDaily * 0.25);
		const p50 = fmtCost(maxDaily * 0.5);
		const p75 = fmtCost(maxDaily * 0.75);
		const p100 = fmtCost(maxDaily);
		lines.push(`  ${D}Scale: $0  ${p25}  ${p50}  ${p75}  ${p100}${RST}`);
	}

	// Stats summary
	{
		let daysWithData = 0;
		let totalCost = 0;
		for (const week of weeks) {
			for (const cost of week.cells) {
				if (cost > 0) daysWithData++;
				totalCost += cost;
			}
		}
		lines.push(`${D}${daysWithData} active days  ·  total ${fmtCost(totalCost)}${RST}`);
	}

	return lines.join("\n");
}
