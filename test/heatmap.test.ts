import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageRecord } from "../src/types";

const scanAllSessions = vi.fn<() => UsageRecord[]>();

vi.mock("../src/scan", () => ({
  scanAllSessions,
}));

const { cmdUsageHeatmap } = await import("../src/heatmap");
const { stripAnsi } = await import("../src/format");

const LEVEL_COLORS = [
  "\x1b[38;2;22;27;34m",
  "\x1b[38;2;14;68;41m",
  "\x1b[38;2;0;109;50m",
  "\x1b[38;2;38;166;65m",
  "\x1b[38;2;57;211;83m",
];

function record(day: number, totalTokens: number): UsageRecord {
  const date = new Date(2026, 3, day, 12);
  return {
    timestamp: date.getTime(),
    isoTimestamp: date.toISOString(),
    provider: "openai-codex",
    model: "gpt-5.4",
    project: "/Users/test/project",
    sessionId: `session-${day}`,
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    costTotal: 0,
  };
}

function cellsAtLevel(output: string, level: number): number {
  const marker = `${LEVEL_COLORS[level]}■`;
  return output.split(marker).length - 1;
}

describe("usage heatmap", () => {
  beforeEach(() => {
    scanAllSessions.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 8, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses non-zero daily quartiles so one extreme day does not flatten the colors", () => {
    const values = [20_000, 30_000, 40_000, 50_000, 70_000, 90_000, 120_000, 10_000_000];
    scanAllSessions.mockReturnValue(values.map((value, index) => record(index + 1, value)));

    const output = cmdUsageHeatmap(8);
    const plain = stripAnsi(output);

    expect(plain).toContain("daily quartiles  ·  10.0M peak");
    expect(plain).toContain("Quartiles: 0  <38K  <60K  <98K  ≥98K");
    for (let level = 1; level <= 4; level++) {
      expect(cellsAtLevel(output, level)).toBeGreaterThan(1);
    }
  });

  it("keeps equal non-zero values in the same highest quartile", () => {
    scanAllSessions.mockReturnValue([
      record(5, 50_000),
      record(6, 50_000),
      record(7, 50_000),
      record(8, 50_000),
    ]);

    const output = cmdUsageHeatmap(4);

    expect(cellsAtLevel(output, 1)).toBe(1);
    expect(cellsAtLevel(output, 2)).toBe(1);
    expect(cellsAtLevel(output, 3)).toBe(1);
    expect(cellsAtLevel(output, 4)).toBe(5);
  });

  it("renders a single active day at the highest intensity", () => {
    scanAllSessions.mockReturnValue([record(8, 50_000)]);

    const output = cmdUsageHeatmap(7);

    expect(cellsAtLevel(output, 4)).toBe(2);
    expect(stripAnsi(output)).toContain("Quartiles: 0  <50K  <50K  <50K  ≥50K");
  });
});
