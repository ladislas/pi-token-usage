import { B, CYAN, D, RST } from "./ansi";
import { fmtTokens } from "./format";
import { scanAllSessions } from "./scan";
import { toDateStr } from "./dates";

// GitHub-style contribution heatmap colors (truecolor ANSI foreground)
const LEVEL_COLORS = [
  "\x1b[38;2;22;27;34m", // 0: #161b22 — no activity / very dim
  "\x1b[38;2;14;68;41m", // 1: #0e4429 — light
  "\x1b[38;2;0;109;50m", // 2: #006d32 — medium-light
  "\x1b[38;2;38;166;65m", // 3: #26a641 — medium
  "\x1b[38;2;57;211;83m", // 4: #39d353 — heavy
];

const GAPPED_CELL = "■";
const COMPACT_CELL = "█";
const GAP = " ";
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type QuartileThresholds = readonly [number, number, number];

function quantile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;

  const index = (sortedValues.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function getQuartileThresholds(values: number[]): QuartileThresholds {
  const sortedValues = values.filter((value) => value > 0).sort((a, b) => a - b);
  return [
    quantile(sortedValues, 0.25),
    quantile(sortedValues, 0.5),
    quantile(sortedValues, 0.75),
  ];
}

function getLevel(value: number, thresholds: QuartileThresholds): number {
  if (value <= 0) return 0;
  if (value < thresholds[0]) return 1;
  if (value < thresholds[1]) return 2;
  if (value < thresholds[2]) return 3;
  return 4;
}

/**
 * Render a GitHub-style contribution heatmap of daily token usage,
 * adapting to terminal width automatically.
 *
 * Layout (7 rows × ~53 columns):
 *
 *     Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
 *   Sun ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■
 *   Mon ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■
 *   ...
 *   Sat ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■
 *
 *   Less  ■ ■ ■ ■ ■  More
 *   Quartiles: 0  <10K  <20K  <50K  ≥50K
 */
export function cmdUsageHeatmap(n: number = 365): string {
  const records = scanAllSessions();
  if (records.length === 0) return "No usage data found.";

  // Detect terminal width — fallback to 80 if not available
  const termWidth = process.stdout.columns ?? 80;

  // Date range: [today - n + 1, today]
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (n - 1));
  const startMs = start.getTime();
  const endMs = today.getTime() + 86_400_000 - 1;

  // Aggregate daily tokens
  const dailyData = new Map<string, number>();
  for (const r of records) {
    if (r.timestamp < startMs || r.timestamp > endMs) continue;
    const day = toDateStr(r.timestamp);
    dailyData.set(day, (dailyData.get(day) ?? 0) + r.totalTokens);
  }

  // --- Build grid ---
  // Align so rightmost column ends on today.
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // back to Sunday

  const gridEnd = new Date(today);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay())); // forward to Saturday

  const totalDays =
    Math.round((gridEnd.getTime() - gridStart.getTime()) / 86_400_000) + 1;
  const numWeeks = Math.ceil(totalDays / 7);

  const weeks: Array<{ cells: number[]; monthLabel?: string }> = [];
  const cursor = new Date(gridStart);

  for (let w = 0; w < numWeeks; w++) {
    const info: { cells: number[]; monthLabel?: string } = {
      cells: [0, 0, 0, 0, 0, 0, 0],
    };

    for (let d = 0; d < 7; d++) {
      const dateStr = toDateStr(cursor.getTime());
      info.cells[d] = dailyData.get(dateStr) ?? 0;

      if (cursor.getDate() === 1 && cursor <= today) {
        info.monthLabel = MONTH_NAMES[cursor.getMonth()];
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    weeks.push(info);
  }

  // --- Decide cell spacing based on terminal width ---
  const whiteSpace = 7 + 2; // "  Sun  "+"  "
  const availWidth = termWidth - whiteSpace;
  const useGap = availWidth >= weeks.length * 2;

  // If even compact (no gap) doesn't fit, truncate to most recent weeks
  let displayWeeks = weeks;
  let truncated = false;
  if (!useGap && availWidth < weeks.length) {
    const maxWeeks = Math.max(availWidth, 4); // at least 4 weeks
    displayWeeks = weeks.slice(weeks.length - maxWeeks);
    truncated = true;
  }

  let daysWithData = 0;
  let totalTokens = 0;
  let peakDaily = 0;
  const activeDailyValues: number[] = [];
  for (const week of displayWeeks) {
    for (const value of week.cells) {
      totalTokens += value;
      if (value <= 0) continue;
      daysWithData++;
      activeDailyValues.push(value);
      if (value > peakDaily) peakDaily = value;
    }
  }
  const quartileThresholds = getQuartileThresholds(activeDailyValues);

  // Cell renderer — with or without trailing gap
  function renderCell(level: number): string {
    const char = useGap ? GAPPED_CELL : COMPACT_CELL;
    const gap = useGap ? GAP : "";
    return `${LEVEL_COLORS[level]}${char}${RST}${gap}`;
  }

  // --- Render ---
  const lines: string[] = [];

  lines.push(`${B}${CYAN}── Token Usage Heatmap ──${RST}`);
  lines.push(
    `${D}Last ${n} days  ·  daily quartiles  ·  ${fmtTokens(peakDaily)} peak${RST}`,
  );
  if (truncated) {
    lines.push(
      `${D}Terminal too narrow — showing ${displayWeeks.length} of ${weeks.length} weeks${RST}`,
    );
  }
  lines.push("");

  // Month label row
  {
    const colW = useGap ? 2 : 1;
    const monthRow = new Array<string>(displayWeeks.length * colW).fill(" ");
    for (let w = 0; w < displayWeeks.length; w++) {
      const label = displayWeeks[w].monthLabel;
      if (label) {
        const offset = w * colW;
        for (let c = 0; c < label.length && offset + c < monthRow.length; c++) {
          monthRow[offset + c] = label[c];
        }
      }
    }
    lines.push(`      ${monthRow.join("")}`);
  }

  // Day rows
  for (let d = 0; d < 7; d++) {
    let row = `  ${DAY_LABELS[d]}  `;
    for (const week of displayWeeks) {
      const level = getLevel(week.cells[d], quartileThresholds);
      row += renderCell(level);
    }
    lines.push(row);
  }

  // Legend
  lines.push("");
  {
    const legendCells = [0, 1, 2, 3, 4].map((l) => renderCell(l)).join("");
    lines.push(`  Less  ${legendCells} More`);
  }

  // Quartile scale
  if (peakDaily > 0) {
    const [q25, q50, q75] = quartileThresholds.map(fmtTokens);
    lines.push(
      `  ${D}Quartiles: 0  <${q25}  <${q50}  <${q75}  ≥${q75}${RST}`,
    );
  }

  // Stats summary
  lines.push(
    `${D}${daysWithData} active days  ·  total ${fmtTokens(totalTokens)}${RST}`,
  );

  return lines.join("\n");
}
